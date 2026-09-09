/**
 * Client-Side ONNX Inference for Cough Detection
 *
 * 100% on-device inference using ONNX Runtime.
 * - Web: onnxruntime-web (WASM backend), model served from public/models/
 * - React Native: onnxruntime-react-native (native backend), model bundled as an asset
 *
 * Pipeline (one graph, one inference per recording):
 *   1. Decode the recording to a 16 kHz mono float32 waveform
 *      (FFmpeg on native, WebAudio on web)
 *   2. Copy it into a fixed-length buffer sized by the graph itself,
 *      zero-padding the tail
 *   3. Run the graph once, telling it how many leading samples are real audio
 *   4. Compare the returned probability against DETECTION_THRESHOLD
 *
 * --------------------------------------------------------------------------
 * HISTORY: why this replaced the two-model pipeline (2026-09-08)
 * --------------------------------------------------------------------------
 * This used to be `cough_preprocessing.onnx` (waveform -> mel spectrogram) then
 * `cough_detector_int8.onnx` (spectrograms -> prediction), with the waveform cut
 * into 2 s segments at a 0.5 s hop, capped at 32 segments, and the per-segment
 * scores pooled into a bag probability. 19.4 MiB across the two graphs.
 *
 * It is now a single graph (CED-tiny + LoRA, 6.63 MiB int8) that fuses the mel
 * frontend, the encoder and the scoring head, taking raw audio and returning one
 * probability. Segmentation is gone because the graph does its own chunking
 * internally and then pools across every chunk's tokens *jointly*, which is what
 * the trained checkpoint does. That matters: pooling once over the whole
 * recording is not the same as taking the best of N independently scored
 * windows, and the difference is not academic. On the out-of-distribution split,
 * max-over-windows measured precision 0.8346 where joint pooling measured
 * 0.8856 at the same recall, because every extra window is another independent
 * chance to fire on a non-cough.
 *
 * The buffer is 60 s to match this app's own recording cap, so no take the UI
 * can produce is ever truncated. Accuracy actually saturates at 30 s on the
 * research splits (they contain almost nothing longer), so the extra width buys
 * head-room rather than accuracy, at ~2x the latency. Measured single-threaded
 * on a desktop CPU: 10 s buffer 20.8 ms, 60 s buffer 125.4 ms. Expect several
 * times that on a low-end field device; it runs once when the collector stops
 * recording, behind the existing spinner.
 *
 * --------------------------------------------------------------------------
 * THE LENGTH INPUT IS NOT OPTIONAL
 * --------------------------------------------------------------------------
 * The graph's second input says how many leading samples of the buffer are real
 * audio, and it drives a padding mask that is *part of the model*. A graph told
 * "the whole buffer is real" pools over dB-floor padding as if it were audio,
 * which is not the rule the head was fitted under. On the 60 s graph, over real
 * validation clips at this threshold, dropping it moved 25.8% of near-threshold
 * decisions and inflated scores on negatives, i.e. it invents coughs.
 *
 * Feeding it requires the model to have been prepared by
 * `npm run prepare:model` first, because the exporter ships that input with a
 * default value and onnxruntime-react-native's Android bridge silently discards
 * feeds for such inputs. `scripts/prepare-detector-model.mjs` documents the
 * mechanism in full. `resolveDetectorGraph` below refuses to start on an
 * unprepared model rather than scoring every recording on the wrong rule.
 *
 * --------------------------------------------------------------------------
 * SWAPPING THE MODEL
 * --------------------------------------------------------------------------
 * Nothing here is specific to CED. The graph's own signature supplies the input
 * names, the buffer length and the output name, all read at load time, so a
 * different single-graph detector (PANNs, or a re-export at a different width)
 * needs no code change. To swap:
 *
 *   1. `npm run prepare:model -- assets/models/<DIR>/<NAME>.onnx`
 *   2. point `require()` in `src/assets/models.native.ts` at the prepared file
 *   3. update DETECTOR below (web path, cache name, threshold)
 *
 * The threshold is the one thing that cannot be discovered: it is a property of
 * the trained checkpoint, not of the graph. Ship the checkpoint's own selected
 * threshold, never 0.5.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import { Buffer } from 'buffer';

// --------------------------------------------------------------------------
// The detector model. This block plus the require() in models.native.ts is
// everything that identifies which model ships.
// --------------------------------------------------------------------------

const DETECTOR = {
  /** Served from public/ on web. */
  webPath: '/models/CED/CED_int8.app.onnx',
  /** Base name for the on-device cache copy; the asset hash is appended. */
  cacheBaseName: 'CED_int8.app',
  /**
   * Input sample rate the graph's mel frontend assumes. Not discoverable from
   * the graph, but 16 kHz for every model in this family.
   */
  sampleRate: 16000,
  /**
   * The checkpoint's own val-selected threshold (CED-tiny + LoRA: 0.4758).
   * PANNs, for reference, selected 0.4652. Never 0.5.
   */
  threshold: 0.4758,
};

/**
 * Cough decision threshold. Exported because NewParticipantScreen re-derives
 * `coughDetected` from a stored confidence when reloading a saved record, and
 * the two must never drift apart.
 */
export const DETECTION_THRESHOLD = DETECTOR.threshold;

/** Kept for callers that want the decode sample rate. */
const CONFIG = {
  sampleRate: DETECTOR.sampleRate,
};

// ONNX tensor element types we care about (onnx.TensorProto.DataType).
const ELEM_FLOAT32 = 1;
const ELEM_INT64 = 7;

// FFmpeg-kit for audio decoding (React Native only)
// This ensures audio is decoded exactly like the Python evaluation script using ffmpeg
let FFmpegKit: any = null;

async function loadFFmpegKit() {
  if (Platform.OS === 'web') {
    return false;
  }

  if (FFmpegKit === null) {
    try {
      const ffmpegModule = require('ffmpeg-kit-react-native');
      FFmpegKit = ffmpegModule.FFmpegKit;
      console.log('[ONNX] FFmpegKit loaded successfully');
      return true;
    } catch (error) {
      console.warn('[ONNX] FFmpegKit not available:', error);
      return false;
    }
  }
  return true;
}

// Only import MODEL_ASSETS on React Native (not web)
// Using .native.ts extension so Metro doesn't bundle it for web
let MODEL_ASSETS: { detector: any } | null = null;

function getModelAssets() {
  if (Platform.OS === 'web') {
    return { detector: null };
  }

  if (MODEL_ASSETS === null) {
    try {
      // This will only be resolved on React Native due to .native.ts extension
      MODEL_ASSETS = require('../assets/models.native').MODEL_ASSETS;
    } catch (error) {
      console.warn('[ONNX] Failed to load model assets:', error);
      MODEL_ASSETS = { detector: null };
    }
  }

  return MODEL_ASSETS;
}

// Note: We don't import onnxruntime-web directly to avoid Metro bundling issues
// Instead, we load it from CDN for web or use onnxruntime-react-native for native

// Type definitions for ONNX Runtime (works with both web and react-native)
type InferenceSession = any;

/** The graph's I/O signature, read from the model file at load time. */
type DetectorGraph = {
  /** Name of the float32 waveform input. */
  waveformInput: string;
  /** Fixed buffer length in samples, or null when the axis is dynamic. */
  clipSamples: number | null;
  /** Name of the int64 scalar "how many samples are real" input, if present. */
  lengthInput: string | null;
  /** Name of the probability output. */
  outputName: string;
};

// Runtime modules (loaded dynamically based on platform)
let ort: any = null;
let detectorSession: InferenceSession | null = null;
let detectorGraph: DetectorGraph | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Load ONNX Runtime module based on platform
 */
async function loadOrtModule(): Promise<any> {
  if (ort) return ort;

  if (Platform.OS === 'web') {
    // Web: Load ONNX Runtime from global (loaded via script tag in index.html)
    // This avoids Metro bundling issues with onnxruntime-web
    if (typeof window !== 'undefined' && (window as any).ort) {
      ort = (window as any).ort;
      console.log('[ONNX] Using global ort from CDN');
    } else {
      // Fallback: Try to load dynamically from CDN
      console.log('[ONNX] Loading ONNX Runtime from CDN...');
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/ort.min.js';
        script.onload = () => {
          ort = (window as any).ort;
          console.log('[ONNX] ONNX Runtime loaded from CDN');
          resolve();
        };
        script.onerror = () => reject(new Error('Failed to load ONNX Runtime from CDN'));
        document.head.appendChild(script);
      });
    }
    // Configure WASM
    if (ort && ort.env && ort.env.wasm) {
      ort.env.wasm.numThreads = 4;
      ort.env.wasm.simd = true;
    }
  } else {
    // React Native: use onnxruntime-react-native
    // Check if we're in Expo Go (which doesn't support native modules)
    const Constants = require('expo-constants').default;
    const isExpoGo = Constants.executionEnvironment === 'storeClient';

    if (isExpoGo) {
      throw new Error(
        '❌ ONNX Runtime does NOT work in Expo Go!\n\n' +
        'You MUST create a development build:\n\n' +
        '1. Run: npx expo prebuild --clean -p android\n' +
        '2. Build: npx expo run:android\n' +
        '3. Install the built app on your device\n\n' +
        'See CRITICAL_SETUP_STEPS.md for complete instructions.'
      );
    }

    try {
      const onnxRuntime = await import('onnxruntime-react-native');
      // onnxruntime-react-native exports the API directly or as default
      ort = onnxRuntime.default || onnxRuntime;

      // Verify that InferenceSession is available
      if (!ort) {
        throw new Error(
          'ONNX Runtime module is null/undefined.\n\n' +
          'CRITICAL: You MUST run prebuild and create a development build:\n' +
          '1. Run: npx expo prebuild --clean -p android\n' +
          '2. Build: npx expo run:android\n' +
          '3. You CANNOT use Expo Go - native modules require a development build'
        );
      }

      if (!ort.InferenceSession) {
        console.error('[ONNX] ort object keys:', ort ? Object.keys(ort) : 'ort is null');
        console.error('[ONNX] ort type:', typeof ort);
        throw new Error(
          'ONNX Runtime InferenceSession is undefined.\n\n' +
          'This means the native module is not properly linked.\n\n' +
          'REQUIRED STEPS:\n' +
          '1. Run: npx expo prebuild --clean -p android\n' +
          '2. Verify MainApplication.kt has OnnxruntimePackage()\n' +
          '3. Build: npx expo run:android (NOT Expo Go)\n' +
          '4. See CRITICAL_SETUP_STEPS.md for details'
        );
      }

      console.log('[ONNX] ONNX Runtime React Native loaded successfully');
      console.log('[ONNX] InferenceSession available:', !!ort.InferenceSession);
    } catch (importError: any) {
      console.error('[ONNX] Failed to import onnxruntime-react-native:', importError);
      const errorMsg = importError.message || String(importError);

      if (errorMsg.includes('Cannot read property') || errorMsg.includes('install')) {
        throw new Error(
          '❌ Native module not linked!\n\n' +
          'The "Cannot read property" error means the native module is missing.\n\n' +
          'REQUIRED STEPS:\n' +
          '1. Run: npx expo prebuild --clean -p android\n' +
          '2. Verify android/app/src/main/java/.../MainApplication.kt has:\n' +
          '   - import ai.onnxruntime.reactnative.OnnxruntimePackage;\n' +
          '   - add(OnnxruntimePackage())\n' +
          '3. Build: npx expo run:android\n' +
          '4. See CRITICAL_SETUP_STEPS.md for complete guide'
        );
      }

      throw new Error(
        `Failed to load ONNX Runtime: ${errorMsg}\n\n` +
        'Make sure:\n' +
        '1. You ran: npx expo prebuild -p android\n' +
        '2. The native module is properly linked\n' +
        '3. You\'re using a development build (not Expo Go)\n' +
        '4. See CRITICAL_SETUP_STEPS.md for help'
      );
    }
  }

  return ort;
}

// --------------------------------------------------------------------------
// Reading the graph's I/O signature out of the .onnx file
//
// onnxruntime-react-native exposes input/output *names* but not their shapes:
// its `inputMetadata` getter throws outright ("Getting model metadata is
// currently not implemented for react-native backend"). The buffer length is
// therefore read from the model file itself, which keeps the pipeline
// independent of any hardcoded audio length.
//
// This is a deliberately minimal protobuf walk. It never decodes a weight
// tensor: skipping a length-delimited field only reads its length prefix, so
// the cost is proportional to the number of fields, not to the file size.
// --------------------------------------------------------------------------

type Cursor = { buf: Uint8Array; pos: number; end: number };

function readVarint(c: Cursor): number {
  let result = 0;
  let scale = 1;
  while (c.pos < c.end) {
    const byte = c.buf[c.pos++];
    // Multiply rather than bit-shift: an ONNX length prefix can exceed 2^31,
    // where JavaScript's bitwise operators would wrap to a negative number.
    result += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return result;
    scale *= 128;
    if (scale > 2 ** 63) throw new Error('varint too long');
  }
  throw new Error('truncated varint');
}

function readTag(c: Cursor): { field: number; wire: number } {
  const key = readVarint(c);
  return { field: Math.floor(key / 8), wire: key % 8 };
}

function skipField(c: Cursor, wire: number): void {
  switch (wire) {
    case 0: readVarint(c); return;
    case 1: c.pos += 8; return;
    // Read the length into a local first. `c.pos += readVarint(c)` would be
    // wrong: += evaluates its left operand before the right, so it would add
    // the length to the pre-varint position and land short every time.
    case 2: { const len = readVarint(c); c.pos += len; return; }
    case 5: c.pos += 4; return;
    default: throw new Error(`unsupported protobuf wire type ${wire}`);
  }
}

function subMessage(c: Cursor): Cursor {
  const len = readVarint(c);
  const sub: Cursor = { buf: c.buf, pos: c.pos, end: c.pos + len };
  c.pos += len;
  return sub;
}

function readAsciiString(c: Cursor): string {
  const len = readVarint(c);
  let out = '';
  for (let i = 0; i < len; i++) out += String.fromCharCode(c.buf[c.pos + i]);
  c.pos += len;
  return out;
}

/** TensorShapeProto.Dimension -> a fixed size, or null when the axis is dynamic. */
function parseDim(c: Cursor): number | null {
  let value: number | null = null;
  while (c.pos < c.end) {
    const { field, wire } = readTag(c);
    if (field === 1 && wire === 0) value = readVarint(c);
    else if (field === 2 && wire === 2) { readAsciiString(c); value = null; }
    else skipField(c, wire);
  }
  return value;
}

function parseShape(c: Cursor): (number | null)[] {
  const dims: (number | null)[] = [];
  while (c.pos < c.end) {
    const { field, wire } = readTag(c);
    if (field === 1 && wire === 2) dims.push(parseDim(subMessage(c)));
    else skipField(c, wire);
  }
  return dims;
}

/** TypeProto -> tensor element type and shape, or null if not a tensor. */
function parseType(c: Cursor): { elemType: number; dims: (number | null)[] } | null {
  while (c.pos < c.end) {
    const { field, wire } = readTag(c);
    if (field === 1 && wire === 2) {
      const t = subMessage(c);
      let elemType = 0;
      let dims: (number | null)[] = [];
      while (t.pos < t.end) {
        const inner = readTag(t);
        if (inner.field === 1 && inner.wire === 0) elemType = readVarint(t);
        else if (inner.field === 2 && inner.wire === 2) dims = parseShape(subMessage(t));
        else skipField(t, inner.wire);
      }
      return { elemType, dims };
    }
    skipField(c, wire);
  }
  return null;
}

type GraphValue = { name: string; elemType: number; dims: (number | null)[] };

function parseValueInfo(c: Cursor): GraphValue | null {
  let name = '';
  let type: { elemType: number; dims: (number | null)[] } | null = null;
  while (c.pos < c.end) {
    const { field, wire } = readTag(c);
    if (field === 1 && wire === 2) name = readAsciiString(c);
    else if (field === 2 && wire === 2) type = parseType(subMessage(c));
    else skipField(c, wire);
  }
  return name && type ? { name, elemType: type.elemType, dims: type.dims } : null;
}

/** TensorProto -> its name (field 8), without touching raw_data. */
function parseInitializerName(c: Cursor): string | null {
  let name: string | null = null;
  while (c.pos < c.end) {
    const { field, wire } = readTag(c);
    if (field === 8 && wire === 2) name = readAsciiString(c);
    else skipField(c, wire);
  }
  return name;
}

/**
 * Walk a serialized ONNX ModelProto and return the graph's declared inputs,
 * outputs, and the names of its initializers.
 */
function parseOnnxSignature(bytes: Uint8Array): {
  inputs: GraphValue[];
  outputs: GraphValue[];
  initializers: Set<string>;
} {
  const model: Cursor = { buf: bytes, pos: 0, end: bytes.length };
  while (model.pos < model.end) {
    const { field, wire } = readTag(model);
    if (field === 7 && wire === 2) {
      // ModelProto.graph
      const graph = subMessage(model);
      const inputs: GraphValue[] = [];
      const outputs: GraphValue[] = [];
      const initializers = new Set<string>();
      while (graph.pos < graph.end) {
        const entry = readTag(graph);
        if (entry.field === 11 && entry.wire === 2) {
          const v = parseValueInfo(subMessage(graph));
          if (v) inputs.push(v);
        } else if (entry.field === 12 && entry.wire === 2) {
          const v = parseValueInfo(subMessage(graph));
          if (v) outputs.push(v);
        } else if (entry.field === 5 && entry.wire === 2) {
          const n = parseInitializerName(subMessage(graph));
          if (n) initializers.add(n);
        } else {
          skipField(graph, entry.wire);
        }
      }
      return { inputs, outputs, initializers };
    }
    skipField(model, wire);
  }
  throw new Error('no GraphProto found in the model file');
}

/** Read the raw bytes of the model, from the device cache or over HTTP. */
async function readModelBytes(source: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch model for inspection: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  const base64 = await FileSystem.readAsStringAsync(source, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return Buffer.from(base64, 'base64');
}

/**
 * Work out how to drive this graph, and refuse to run one we would drive wrongly.
 *
 * Everything except the threshold comes from the graph: which input takes the
 * waveform, how long that buffer is, which input takes the real-sample count,
 * and which output carries the probability. Inputs are matched on dtype and
 * rank rather than on name, so a renamed input in a future export still works.
 */
function resolveDetectorGraph(
  bytes: Uint8Array,
  sessionInputNames: string[],
  sessionOutputNames: string[],
): DetectorGraph {
  const { inputs, outputs, initializers } = parseOnnxSignature(bytes);

  const describe = (v: GraphValue) =>
    `${v.name}:${v.elemType === ELEM_FLOAT32 ? 'f32' : v.elemType === ELEM_INT64 ? 'i64' : `t${v.elemType}`}` +
    `[${v.dims.map((d) => (d === null ? '?' : d)).join(',')}]`;

  const waveform = inputs.find((v) => v.elemType === ELEM_FLOAT32 && v.dims.length === 1);
  if (!waveform) {
    throw new Error(
      'This model does not look like a cough detector: expected a float32 input ' +
      `with a single axis (the waveform). Graph inputs: ${inputs.map(describe).join(', ') || 'none'}`
    );
  }

  const length = inputs.find((v) => v.elemType === ELEM_INT64 && v.dims.length === 0);

  // The padding mask is part of the model, so a length input that exists but
  // cannot be fed is not a degraded mode we are willing to run in. See the
  // header comment and scripts/prepare-detector-model.mjs.
  if (length && initializers.has(length.name)) {
    throw new Error(
      `The detector model is not prepared for React Native. Its "${length.name}" input ` +
      'carries a default value, which makes ONNX Runtime treat it as an overridable ' +
      'initializer, and the Android bridge silently discards feeds for those. Every ' +
      'recording would then be scored as if the whole buffer were real audio.\n\n' +
      'Fix: npm run prepare:model -- <path to the .onnx file>\n' +
      'then point src/assets/models.native.ts at the prepared *.app.onnx file.'
    );
  }
  if (length && !sessionInputNames.includes(length.name)) {
    throw new Error(
      `The graph declares a length input "${length.name}" that ONNX Runtime does not ` +
      `accept as a feed (session inputs: ${sessionInputNames.join(', ')}). Re-run ` +
      'npm run prepare:model on this model.'
    );
  }
  // The same capability test onnxruntime-common runs before it will register
  // int64 <-> BigInt64Array; without both halves it maps no constructor for
  // 'int64' and throws a bare "unsupported type: int64" from deep inside the
  // Tensor constructor. Hermes 0.81.5 has both. Checked here so the failure
  // names the actual cause.
  if (length && (typeof BigInt64Array === 'undefined' || !BigInt64Array.from)) {
    throw new Error(
      'This JavaScript engine has no usable BigInt64Array, so the int64 ' +
      `"${length.name}" input cannot be built. The detector would have to run ` +
      'without its padding mask, which it must not do.'
    );
  }
  if (!length) {
    // Not fatal: a future export might bake a full-length mask in deliberately.
    // Loud, because it silently changes what the scores mean.
    console.warn(
      '[ONNX] This graph has no int64 length input. Recordings shorter than the ' +
      'buffer will be scored with their zero padding treated as real audio.'
    );
  }

  const outputName = sessionOutputNames[0] ?? outputs[0]?.name;
  if (!outputName) {
    throw new Error('The model declares no outputs');
  }

  const clipSamples = waveform.dims[0];

  console.log(
    `[ONNX] Graph signature: in(${inputs.map(describe).join(', ')}) ` +
    `out(${outputs.map(describe).join(', ')})`
  );
  console.log(
    `[ONNX] Buffer: ${clipSamples === null ? 'dynamic' : `${clipSamples} samples ` +
      `(${(clipSamples / DETECTOR.sampleRate).toFixed(1)} s at ${DETECTOR.sampleRate} Hz)`}` +
    `, length input: ${length ? length.name : 'none'}, threshold ${DETECTOR.threshold}`
  );

  return {
    waveformInput: waveform.name,
    clipSamples,
    lengthInput: length ? length.name : null,
    outputName,
  };
}

/**
 * Initialize ONNX Runtime session
 * Call this early (e.g. on app load) to pre-load the model
 */
export async function initONNX(): Promise<void> {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log('[ONNX] Initializing ONNX Runtime...');
    console.log('[ONNX] Platform:', Platform.OS);

    try {
      await loadOrtModule();

      // Where the model can be read as bytes, for the signature parse.
      let modelSource: string;

      if (Platform.OS === 'web') {
        console.log('[ONNX] Loading detector model from URL...');
        detectorSession = await ort.InferenceSession.create(DETECTOR.webPath, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        modelSource = DETECTOR.webPath;
        console.log('[ONNX] Detector model loaded');
      } else {
        console.log('[ONNX] Loading detector model for React Native...');

        const assets = getModelAssets();
        if (!assets || !assets.detector) {
          throw new Error(
            'Detector model asset not available. Check the require() in ' +
            'src/assets/models.native.ts and that expo-asset is installed.'
          );
        }

        const asset = Asset.fromModule(assets.detector);
        await asset.downloadAsync();
        if (!asset.localUri) {
          throw new Error('Failed to load detector model asset - localUri is null');
        }

        // The asset hash is part of the cache filename, so shipping a different
        // model (including over OTA) can never be served a stale cached copy
        // that happens to share its name.
        const stamp = asset.hash || 'nohash';
        const detectorPath =
          `${FileSystem.cacheDirectory}${DETECTOR.cacheBaseName}.${stamp}.onnx`;

        const info = await FileSystem.getInfoAsync(detectorPath);
        if (!info.exists) {
          console.log('[ONNX] Copying detector model from assets...');
          await FileSystem.copyAsync({ from: asset.localUri, to: detectorPath });
          console.log('[ONNX] Detector model copied to cache');
        }

        if (!ort || !ort.InferenceSession) {
          throw new Error(
            'ONNX Runtime InferenceSession is not available. The native module may not ' +
            'be properly linked. Run: npx expo prebuild -p android'
          );
        }

        detectorSession = await ort.InferenceSession.create(detectorPath);
        modelSource = detectorPath;
        console.log('[ONNX] Detector model loaded');
      }

      const bytes = await readModelBytes(modelSource);
      detectorGraph = resolveDetectorGraph(
        bytes,
        detectorSession.inputNames ?? [],
        detectorSession.outputNames ?? [],
      );

      isInitialized = true;
      console.log('[ONNX] Initialization complete');
    } catch (error) {
      // Leave nothing half-built: a retry should redo the whole thing rather
      // than reuse a session with no resolved signature.
      detectorSession = null;
      detectorGraph = null;
      initPromise = null;
      console.error('[ONNX] Failed to initialize:', error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Check if ONNX is initialized
 */
export function isONNXReady(): boolean {
  return isInitialized;
}

/**
 * Decode WAV file to Float32Array waveform
 * Simple WAV file parser - supports PCM format
 * Returns both waveform and sample rate
 */
function decodeWAV(audioData: ArrayBuffer): { waveform: Float32Array; sampleRate: number } {
  const view = new DataView(audioData);

  // Check RIFF header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') {
    throw new Error('Not a valid WAV file (missing RIFF header)');
  }

  // Check WAVE header
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== 'WAVE') {
    throw new Error('Not a valid WAV file (missing WAVE header)');
  }

  // Find fmt chunk
  let offset = 12;
  let sampleRate = 16000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      // Parse fmt chunk
      const audioFormat = view.getUint16(offset + 8, true);
      if (audioFormat !== 1) {
        throw new Error('Only PCM format is supported (format: ' + audioFormat + ')');
      }
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    // RIFF chunks are word-aligned: if chunkSize is odd, there's a pad byte
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (dataOffset === 0) {
    throw new Error('No data chunk found in WAV file');
  }

  // Read audio data
  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = dataSize / bytesPerSample;
  const samplesPerChannel = totalSamples / channels;
  const waveform = new Float32Array(samplesPerChannel);

  if (bitsPerSample === 16) {
    // 16-bit PCM
    if (channels === 1) {
      for (let i = 0; i < samplesPerChannel; i++) {
        const sample = view.getInt16(dataOffset + i * 2, true);
        waveform[i] = sample / 32768.0; // Normalize to [-1, 1]
      }
    } else {
      // Stereo - mix to mono
      for (let i = 0; i < samplesPerChannel; i++) {
        const left = view.getInt16(dataOffset + i * channels * 2, true) / 32768.0;
        const right = view.getInt16(dataOffset + i * channels * 2 + 2, true) / 32768.0;
        waveform[i] = (left + right) / 2;
      }
    }
  } else if (bitsPerSample === 8) {
    // 8-bit PCM
    if (channels === 1) {
      for (let i = 0; i < samplesPerChannel; i++) {
        const sample = view.getUint8(dataOffset + i);
        waveform[i] = (sample - 128) / 128.0; // Normalize to [-1, 1]
      }
    } else {
      // Stereo - mix to mono
      for (let i = 0; i < samplesPerChannel; i++) {
        const left = (view.getUint8(dataOffset + i * channels) - 128) / 128.0;
        const right = (view.getUint8(dataOffset + i * channels + 1) - 128) / 128.0;
        waveform[i] = (left + right) / 2;
      }
    }
  } else {
    throw new Error(`Unsupported bit depth: ${bitsPerSample} bits`);
  }

  return { waveform, sampleRate };
}

/**
 * Decode audio using FFmpeg (React Native only)
 * This ensures audio is decoded EXACTLY like the Python evaluation script
 * which uses: ffmpeg -i input -f f32le -ar 16000 -ac 1 -
 *
 * @param audioUri - File URI to the audio file
 * @returns Float32Array waveform normalized to [-1, 1]
 */
async function decodeAudioWithFFmpeg(audioUri: string): Promise<Float32Array> {
  const ffmpegAvailable = await loadFFmpegKit();
  if (!ffmpegAvailable || !FFmpegKit) {
    throw new Error('FFmpegKit not available');
  }

  console.log('[ONNX] Decoding audio with FFmpeg:', audioUri);

  // Create output file path for raw PCM data
  const timestamp = Date.now();
  const outputPath = `${FileSystem.cacheDirectory}ffmpeg_output_${timestamp}.pcm`;

  // Normalize input path (remove file:// prefix if present)
  let inputPath = audioUri;
  if (inputPath.startsWith('file://')) {
    inputPath = inputPath.substring(7);
  }

  // FFmpeg command to convert to raw PCM: 16kHz, mono, float32 little-endian
  // This EXACTLY matches TypeScript evaluation: ffmpeg -i input -f f32le -ar 16000 -ac 1 -
  const command = `-i "${inputPath}" -f f32le -ar ${CONFIG.sampleRate} -ac 1 -y "${outputPath}"`;

  console.log('[ONNX] FFmpeg command:', command);

  try {
    // Execute FFmpeg command
    const session = await FFmpegKit.execute(command);
    const returnCode = await session.getReturnCode();

    if (returnCode.isValueSuccess()) {
      console.log('[ONNX] FFmpeg conversion successful');

      // Read the raw PCM file
      const pcmData = await FileSystem.readAsStringAsync(outputPath, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Convert base64 to ArrayBuffer
      const binaryString = atob(pcmData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Read Float32 samples directly (f32le = float32 little-endian)
      // FFmpeg already outputs normalized [-1, 1] float values
      const view = new DataView(bytes.buffer);
      const numSamples = bytes.length / 4; // 4 bytes per float32
      const waveform = new Float32Array(numSamples);

      for (let i = 0; i < numSamples; i++) {
        waveform[i] = view.getFloat32(i * 4, true); // little-endian float32
      }

      // Log stats for debugging
      let maxVal = 0, minVal = 0;
      for (let i = 0; i < Math.min(waveform.length, 10000); i++) {
        if (waveform[i] > maxVal) maxVal = waveform[i];
        if (waveform[i] < minVal) minVal = waveform[i];
      }
      console.log(`[ONNX] FFmpeg decoded: ${waveform.length} samples at ${CONFIG.sampleRate}Hz, range: [${minVal.toFixed(4)}, ${maxVal.toFixed(4)}]`);

      // Cleanup temp file
      try {
        await FileSystem.deleteAsync(outputPath, { idempotent: true });
      } catch (cleanupError) {
        console.warn('[ONNX] Failed to cleanup FFmpeg temp file:', cleanupError);
      }

      return waveform;
    } else {
      const logs = await session.getAllLogsAsString();
      console.error('[ONNX] FFmpeg conversion failed:', logs);
      throw new Error(`FFmpeg conversion failed with code ${returnCode}`);
    }
  } catch (error: any) {
    // Cleanup temp file on error
    try {
      await FileSystem.deleteAsync(outputPath, { idempotent: true });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Decode audio file to Float32Array waveform (React Native)
 * PRIMARY: Uses FFmpeg for exact match with Python evaluation script
 * FALLBACK: Custom WAV decoder for compatibility
 */
async function decodeAudioReactNative(audioData: ArrayBuffer, audioUri?: string): Promise<Float32Array> {
  // If we have a file URI and FFmpegKit is available, use FFmpeg for exact Python compatibility
  if (audioUri && Platform.OS !== 'web') {
    try {
      return await decodeAudioWithFFmpeg(audioUri);
    } catch (ffmpegError: any) {
      console.warn('[ONNX] FFmpeg decoding failed, falling back to WAV decoder:', ffmpegError.message);
      // Fall through to WAV decoder
    }
  }

  // Fallback: Try WAV decoder
  try {
    const { waveform, sampleRate: fileSampleRate } = decodeWAV(audioData);

    // DEBUG: Log WAV decoding success with stats
    let maxVal = 0, minVal = 0;
    for (let i = 0; i < Math.min(waveform.length, 10000); i++) {
      if (waveform[i] > maxVal) maxVal = waveform[i];
      if (waveform[i] < minVal) minVal = waveform[i];
    }
    console.log(`[ONNX] WAV decoded (fallback): ${waveform.length} samples at ${fileSampleRate}Hz, range: [${minVal.toFixed(4)}, ${maxVal.toFixed(4)}]`);

    // Resample if needed
    let finalWaveform = waveform;
    if (fileSampleRate !== CONFIG.sampleRate) {
      console.log(`[ONNX] Resampling from ${fileSampleRate}Hz to ${CONFIG.sampleRate}Hz`);
      finalWaveform = resample(waveform, fileSampleRate, CONFIG.sampleRate);
    }

    // NO max-abs normalization! Bit-depth normalization only (matching evaluation script).
    return finalWaveform;
  } catch (wavError: any) {
    console.error('[ONNX] All audio decoding methods failed');
    throw new Error(`Audio decoding failed. FFmpeg and WAV decoder both failed. Error: ${wavError.message}`);
  }
}

/**
 * Decode AAC/M4A files using expo-av
 * DEPRECATED: Now using FFmpeg for audio decoding which is more reliable.
 * Keeping this function as a potential fallback if FFmpeg is not available.
 *
 * @deprecated Use FFmpeg-based decoding instead
 */
// @ts-ignore - Keeping as fallback, currently using FFmpeg for audio decoding
async function _decodeAudioWithExpoAV(audioData: ArrayBuffer): Promise<Float32Array> {
  const { Audio } = require('expo-av');

  // Create a temporary file from the ArrayBuffer
  const tempUri = await createTempFileFromArrayBuffer(audioData);

  try {
    console.log('[ONNX] Loading AAC/M4A file with expo-av...');
    // Load audio with expo-av
    const { sound } = await Audio.Sound.createAsync(
      { uri: tempUri },
      { shouldPlay: false }
    );

    const status = await sound.getStatusAsync();
    if (!status.isLoaded) {
      throw new Error('Failed to load audio file with expo-av');
    }

    // Get audio properties
    const durationMillis = status.durationMillis || 0;
    const durationSeconds = durationMillis / 1000;
    const fileSampleRate = status.rate || 16000; // Default to 16kHz if not available

    console.log('[ONNX] Audio properties:', {
      duration: durationSeconds,
      sampleRate: fileSampleRate,
    });

    // WORKAROUND: Use expo-av's recording to capture playback
    // This gives us access to the decoded audio data
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });

    // Create a recording session to capture the playback
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );

    await recording.startAsync();

    // Play the audio (muted)
    await sound.setVolumeAsync(0);
    await sound.playAsync();

    // Wait for playback to complete
    await new Promise<void>((resolve) => {
      const checkStatus = async () => {
        const playStatus = await sound.getStatusAsync();
        if (playStatus.isLoaded && playStatus.didJustFinish) {
          resolve();
        } else if (playStatus.isLoaded && playStatus.isPlaying) {
          setTimeout(checkStatus, 100);
        } else {
          resolve();
        }
      };
      checkStatus();
    });

    // Stop playback and recording
    await sound.stopAsync();
    await recording.stopAndUnloadAsync();
    const recordingUri = recording.getURI();
    await sound.unloadAsync();

    if (!recordingUri) {
      throw new Error('Failed to get recording URI from expo-av');
    }

    // Read the recorded file (should be in a decodable format)
    const recordedData = await FileSystem.readAsStringAsync(recordingUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Convert base64 to ArrayBuffer
    const binaryString = atob(recordedData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const recordedArrayBuffer = bytes.buffer;

    // Try to decode as WAV (the recording might be in WAV format)
    try {
      const { waveform, sampleRate: recordedSampleRate } = decodeWAV(recordedArrayBuffer);

      // Resample if needed
      let finalWaveform = waveform;
      if (recordedSampleRate !== CONFIG.sampleRate) {
        console.log(`[ONNX] Resampling from ${recordedSampleRate}Hz to ${CONFIG.sampleRate}Hz`);
        finalWaveform = resample(waveform, recordedSampleRate, CONFIG.sampleRate);
      }

      // NO max-abs normalization! Bit-depth normalization only (matching evaluation script).
      // decodeWAV already normalizes to [-1, 1] based on bit depth.

      // Clean up temp recording file
      try {
        await FileSystem.deleteAsync(recordingUri, { idempotent: true });
      } catch (cleanupError) {
        console.warn('[ONNX] Failed to cleanup temp recording:', cleanupError);
      }

      return finalWaveform;
    } catch (wavError) {
      // If it's not WAV, we can't decode it
      throw new Error(`Failed to decode recorded audio as WAV: ${wavError instanceof Error ? wavError.message : String(wavError)}`);
    }

  } finally {
    // Clean up temp file
    try {
      const fileInfo = await FileSystem.getInfoAsync(tempUri);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(tempUri, { idempotent: true });
      }
    } catch (cleanupError) {
      console.warn('[ONNX] Failed to cleanup temp file:', cleanupError);
    }
  }
}

/**
 * Create a temporary file from ArrayBuffer
 */
async function createTempFileFromArrayBuffer(audioData: ArrayBuffer): Promise<string> {
  const tempFileName = `temp_audio_${Date.now()}.m4a`;
  const tempUri = `${FileSystem.documentDirectory}${tempFileName}`;

  // Convert ArrayBuffer to base64
  const base64 = arrayBufferToBase64(audioData);

  // Write to file
  await FileSystem.writeAsStringAsync(tempUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return tempUri;
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode audio file to Float32Array waveform (Web only)
 * Handles WAV, WebM, MP3, etc. via WebAudio API
 */
export async function decodeAudioWeb(audioData: ArrayBuffer): Promise<Float32Array> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: CONFIG.sampleRate,
  });

  try {
    const audioBuffer = await audioContext.decodeAudioData(audioData);

    // Get mono channel (average if stereo)
    let waveform: Float32Array;
    if (audioBuffer.numberOfChannels === 1) {
      waveform = audioBuffer.getChannelData(0);
    } else {
      // Mix to mono
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      waveform = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) {
        waveform[i] = (left[i] + right[i]) / 2;
      }
    }

    // Resample if needed
    if (audioBuffer.sampleRate !== CONFIG.sampleRate) {
      waveform = resample(waveform, audioBuffer.sampleRate, CONFIG.sampleRate);
    }

    // NO max-abs normalization! WebAudio API already outputs float32 in [-1, 1].
    // This matches the evaluation script which uses ffmpeg's f32le output.
    // The graph normalizes its own input gain, so a loud and a quiet copy of the
    // same recording score the same.

  // Note: High-pass filter (50Hz) is not applied here because:
  // 1. It's not included in the model's own frontend
  // 2. JavaScript implementation would be complex
  // 3. The model should be robust to this difference for most audio

  return waveform;
  } finally {
    await audioContext.close();
  }
}

/**
 * Simple linear resampling
 */
function resample(data: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const newLength = Math.round(data.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIdx = i * ratio;
    const srcIdxFloor = Math.floor(srcIdx);
    const srcIdxCeil = Math.min(srcIdxFloor + 1, data.length - 1);
    const frac = srcIdx - srcIdxFloor;
    result[i] = data[srcIdxFloor] * (1 - frac) + data[srcIdxCeil] * frac;
  }

  return result;
}

/**
 * Score one waveform through the detector graph.
 *
 * The waveform is copied into a buffer of exactly the length the graph declares
 * and the tail left as zeros, with the real sample count passed alongside so the
 * padding is excluded from the model's pooling.
 *
 * One recording at a time, never batched: the graph normalizes its own input
 * gain and computes a loudness floor over the whole tensor it is handed, so
 * batching two recordings would couple them through that floor and silently
 * change both.
 */
async function runDetector(waveform: Float32Array): Promise<number> {
  if (!detectorSession || !detectorGraph || !ort) {
    throw new Error('Detector model not loaded');
  }

  const { waveformInput, clipSamples, lengthInput, outputName } = detectorGraph;

  // A dynamic axis means the graph accepts the audio at its own length.
  const bufferLength = clipSamples ?? waveform.length;
  const realSamples = Math.min(waveform.length, bufferLength);

  if (waveform.length > bufferLength) {
    console.warn(
      `[ONNX] Recording is ${waveform.length} samples ` +
      `(${(waveform.length / CONFIG.sampleRate).toFixed(1)} s) but the graph's buffer holds ` +
      `${bufferLength} (${(bufferLength / CONFIG.sampleRate).toFixed(1)} s). ` +
      'Scoring the first part only; audio past that point is not seen.'
    );
  }

  let buffer: Float32Array;
  if (waveform.length === bufferLength) {
    buffer = waveform;
  } else {
    buffer = new Float32Array(bufferLength);
    buffer.set(waveform.subarray(0, realSamples));
  }

  const feeds: Record<string, any> = {
    [waveformInput]: new ort.Tensor('float32', buffer, [bufferLength]),
  };
  if (lengthInput) {
    feeds[lengthInput] = new ort.Tensor(
      'int64',
      BigInt64Array.from([BigInt(realSamples)]),
      [],
    );
  }

  const results = await detectorSession.run(feeds);

  const output = results[outputName];
  if (!output) {
    throw new Error(
      `Output "${outputName}" not found. Available: ${Object.keys(results).join(', ')}`
    );
  }

  const probability = Number((output.data as ArrayLike<number>)[0]);
  if (!Number.isFinite(probability)) {
    throw new Error(`Detector returned a non-finite probability: ${probability}`);
  }
  return probability;
}

/**
 * Full inference pipeline
 * Takes audio ArrayBuffer and returns detection results
 */
export async function detectCough(audioData: ArrayBuffer, audioUri?: string): Promise<{
  coughDetected: boolean;
  tbDetected: boolean;
  confidence: number;
  file_probability: number;
  threshold_used: number;
  message: string;
  mode: string;
}> {
  // Ensure the model is loaded
  await initONNX();

  console.log('[ONNX] Starting inference...');
  const startTime = performance.now();

  // 1. Decode audio to a 16 kHz mono waveform
  console.log('[ONNX] Decoding audio...');
  let waveform: Float32Array;

  if (Platform.OS === 'web') {
    waveform = await decodeAudioWeb(audioData);
  } else {
    // For React Native, decode audio using FFmpeg (exact Python match) or WAV decoder
    waveform = await decodeAudioReactNative(audioData, audioUri);
  }

  console.log(
    `[ONNX] Decoded ${waveform.length} samples ` +
    `(${(waveform.length / CONFIG.sampleRate).toFixed(2)} s)`
  );

  if (waveform.length === 0) {
    throw new Error('Audio decoded to zero samples');
  }

  // 2. Score it in a single pass
  const probability = await runDetector(waveform);

  const endTime = performance.now();
  console.log(`[ONNX] Inference complete in ${(endTime - startTime).toFixed(0)}ms`);
  console.log(`[ONNX] Probability: ${probability.toFixed(4)}`);

  const threshold = DETECTOR.threshold;
  const coughDetected = probability > threshold;
  // TB threshold, deliberately unreachable in Phase 1: this model scores cough
  // presence only and says nothing about TB.
  const tbDetected = probability > 1;

  return {
    coughDetected,
    tbDetected,
    confidence: probability,
    file_probability: probability,
    threshold_used: threshold,
    message: coughDetected
      ? `Cough detected with ${(probability * 100).toFixed(1)}% confidence (client-side ONNX)`
      : 'No cough pattern detected',
    mode: 'CLIENT_SIDE_ONNX',
  };
}

/**
 * Fetch audio from URL/blob and run detection
 */
export async function detectCoughFromUrl(audioUrl: string): Promise<ReturnType<typeof detectCough>> {
  console.log('[ONNX] Fetching audio from:', audioUrl);
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
  }
  const audioData = await response.arrayBuffer();
  console.log(`[ONNX] Fetched ${audioData.byteLength} bytes`);
  // Pass audioUrl so FFmpeg can decode directly from file (more reliable)
  return detectCough(audioData, audioUrl);
}

/**
 * Get model info
 */
export function getModelInfo(): {
  isReady: boolean;
  detectorLoaded: boolean;
  platform: string;
  sampleRate: number;
  threshold: number;
  clipSamples: number | null;
  bufferSeconds: number | null;
  lengthInput: string | null;
} {
  const clipSamples = detectorGraph ? detectorGraph.clipSamples : null;
  return {
    isReady: isInitialized,
    detectorLoaded: detectorSession !== null,
    platform: Platform.OS,
    sampleRate: CONFIG.sampleRate,
    threshold: DETECTOR.threshold,
    clipSamples,
    bufferSeconds: clipSamples === null ? null : clipSamples / CONFIG.sampleRate,
    lengthInput: detectorGraph ? detectorGraph.lengthInput : null,
  };
}

/**
 * Download the model to cache (for React Native)
 * Only needed if the model is served remotely rather than bundled.
 */
export async function downloadModels(baseUrl: string): Promise<void> {
  if (Platform.OS === 'web') {
    console.log('[ONNX] Web platform - model loaded from public folder');
    return;
  }

  const name = `${DETECTOR.cacheBaseName}.onnx`;
  const localPath = `${FileSystem.cacheDirectory}${name}`;
  const info = await FileSystem.getInfoAsync(localPath);

  if (!info.exists) {
    console.log(`[ONNX] Downloading ${name}...`);
    await FileSystem.downloadAsync(`${baseUrl}${DETECTOR.webPath}`, localPath);
    console.log(`[ONNX] Downloaded ${name}`);
  } else {
    console.log(`[ONNX] ${name} already in cache`);
  }
}
