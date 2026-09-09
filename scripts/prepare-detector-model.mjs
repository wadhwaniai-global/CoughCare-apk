#!/usr/bin/env node
/**
 * Make an exported cough-detector ONNX graph loadable by onnxruntime-react-native.
 *
 * Run this once on any new detector graph before pointing the app at it:
 *
 *   npm run prepare:model -- assets/models/CED/CED_int8.onnx
 *   npm run prepare:model -- IN.onnx -o OUT.onnx
 *   npm run prepare:model -- IN.onnx --in-place        # idempotent, safe to re-run
 *
 * Node only. No Python, no external tooling, no dependency on any other repo.
 * `onnxruntime-node` (already a devDependency) is used for verification if it
 * resolves, and skipped with a warning if it does not.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (2026-09-08)
 * ---------------------------------------------------------------------------
 * The detector graphs take two inputs: `waveform` (a fixed-length 16 kHz
 * buffer) and `n_samples`, which says how many leading samples of that buffer
 * are real audio. The padding mask is part of the model -- a graph told "the
 * whole buffer is real" pools over dB-floor padding as though it were audio,
 * which is not the rule the head was trained under.
 *
 * The exporter deliberately gives `n_samples` an ONNX *initializer* as a
 * default so callers may omit it. ONNX Runtime then classifies it as an
 * "overridable initializer" rather than a graph input. In Python that is
 * invisible: `session.run()` accepts it either way.
 *
 * On Android it is not invisible. onnxruntime-react-native's bridge builds the
 * feed by iterating the session's *declared inputs*:
 *
 *   // node_modules/onnxruntime-react-native/android/src/main/java/
 *   //   ai/onnxruntime/reactnative/OnnxruntimeModule.java  (run(), ~line 273)
 *   Iterator<String> iterator = ortSession.getInputNames().iterator();
 *   while (iterator.hasNext()) { String inputName = iterator.next(); ... }
 *
 * `getInputNames()` maps to the C API's `SessionGetInputCount`, which EXCLUDES
 * overridable initializers. So `n_samples` never appears in that loop, whatever
 * the JS side passes under that key is silently discarded, and the graph falls
 * back to "the entire buffer is real audio". No error, no warning.
 *
 * Measured cost on the 60 s CED graph over real validation clips at threshold
 * 0.4758 -- correct mask vs. dropped mask:
 *
 *   | sample                    | mean |diff| | max |diff| | decisions flipped |
 *   |---------------------------|-------------|------------|-------------------|
 *   | clips near the threshold  | 0.125       | 0.578      | 31/120  (25.8%)   |
 *   | random clips              | 0.028       | 0.678      |  3/120  ( 2.5%)   |
 *
 * and it leans the wrong way: random negatives move +0.023 on average, i.e. the
 * model invents coughs. Worst single case measured was a 4.7 s negative scoring
 * 0.21 with the mask and 0.89 without.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 * ---------------------------------------------------------------------------
 * Deletes the initializer supplying that default, which promotes the input from
 * "overridable initializer" to a plain required graph input. `getInputNames()`
 * then lists it, the bridge feeds it, and the mask works.
 *
 * Nothing else changes: no re-quantization, no node edits, no weight changes.
 * It is a byte splice -- remove one length-delimited `initializer` entry from
 * GraphProto and rewrite the enclosing length prefix. Verified bit-identical:
 * the same clip through the original and the prepared graph, both with
 * `n_samples` supplied explicitly, agrees to 0.0e+00.
 *
 * The one trade-off, stated plainly: the prepared graph will no longer run in a
 * caller that feeds `waveform` alone, because the length is now mandatory.
 * That is the intended behaviour -- omitting it can no longer silently happen.
 * Keep the original export for any such caller; this output is for the app.
 * Hence the default output is a sibling `*.app.onnx`, not an in-place rewrite.
 *
 * It is model-agnostic on purpose: it targets any scalar int64 graph input that
 * is backed by an initializer, whatever that input is named, so a future
 * detector export needs no change here.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const ELEM_FLOAT32 = 1;
const ELEM_INT64 = 7;

// ---------------------------------------------------------------------------
// A minimal protobuf reader. Enough to walk an ONNX ModelProto's structure and
// record byte spans; it never needs to decode a weight tensor's payload, so
// skipping a field is O(1) regardless of how many megabytes it holds.
// ---------------------------------------------------------------------------

function reader(buf, pos = 0, end = buf.length) {
  return { buf, pos, end };
}

function readVarint(c) {
  let result = 0;
  let shift = 1;
  while (c.pos < c.end) {
    const byte = c.buf[c.pos++];
    // Multiply rather than shift: a length prefix can exceed 2^31, where the
    // bitwise operators would silently wrap to a negative number.
    result += (byte & 0x7f) * shift;
    if ((byte & 0x80) === 0) return result;
    shift *= 128;
    if (shift > 2 ** 63) throw new Error('varint too long');
  }
  throw new Error('truncated varint');
}

function readTag(c) {
  const key = readVarint(c);
  return { field: Math.floor(key / 8), wire: key % 8 };
}

function skipField(c, wire) {
  switch (wire) {
    case 0: readVarint(c); return;
    case 1: c.pos += 8; return;
    // `c.pos += readVarint(c)` would be wrong: += evaluates the left operand
    // before the right, so it would add the length to the pre-varint position
    // and land short by the length prefix's own byte count.
    case 2: { const len = readVarint(c); c.pos += len; return; }
    case 5: c.pos += 4; return;
    default: throw new Error(`unsupported wire type ${wire}`);
  }
}

/** Read a length-delimited field as a sub-reader, advancing the parent past it. */
function subMessage(c) {
  const len = readVarint(c);
  const sub = reader(c.buf, c.pos, c.pos + len);
  c.pos += len;
  return sub;
}

function readString(c) {
  const len = readVarint(c);
  const s = c.buf.toString('utf8', c.pos, c.pos + len);
  c.pos += len;
  return s;
}

function encodeVarint(value) {
  const out = [];
  let n = value;
  while (n > 0x7f) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// ONNX structure walkers
// ---------------------------------------------------------------------------

/** TensorShapeProto.Dimension -> a number, or null when the dim is dynamic. */
function parseDim(c) {
  let value = null;
  while (c.pos < c.end) {
    const { field, wire } = readTag(c);
    if (field === 1 && wire === 0) value = readVarint(c);
    else if (field === 2 && wire === 2) { readString(c); value = null; }
    else skipField(c, wire);
  }
  return value;
}

function parseShape(c) {
  const dims = [];
  while (c.pos < c.end) {
    const { field, wire } = readTag(c);
    if (field === 1 && wire === 2) dims.push(parseDim(subMessage(c)));
    else skipField(c, wire);
  }
  return dims;
}

/** TypeProto -> { elemType, dims }, or null if it is not a tensor type. */
function parseType(c) {
  while (c.pos < c.end) {
    const { field, wire } = readTag(c);
    if (field === 1 && wire === 2) {
      const t = subMessage(c);
      let elemType = 0;
      let dims = [];
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

function parseValueInfo(c) {
  let name = '';
  let type = null;
  while (c.pos < c.end) {
    const { field, wire } = readTag(c);
    if (field === 1 && wire === 2) name = readString(c);
    else if (field === 2 && wire === 2) type = parseType(subMessage(c));
    else skipField(c, wire);
  }
  return name && type ? { name, elemType: type.elemType, dims: type.dims } : null;
}

/** TensorProto -> its `name` (field 8), without touching raw_data. */
function parseTensorName(c) {
  let name = null;
  while (c.pos < c.end) {
    const { field, wire } = readTag(c);
    if (field === 8 && wire === 2) name = readString(c);
    else skipField(c, wire);
  }
  return name;
}

/**
 * Locate ModelProto.graph (field 7) and return where its header and payload sit,
 * so the payload can be spliced and the length prefix rewritten.
 */
function locateGraph(buf) {
  const c = reader(buf);
  while (c.pos < c.end) {
    const headerStart = c.pos;
    const { field, wire } = readTag(c);
    if (field === 7 && wire === 2) {
      const length = readVarint(c);
      return { headerStart, payloadStart: c.pos, length };
    }
    skipField(c, wire);
  }
  throw new Error('no GraphProto (field 7) found -- is this an ONNX model?');
}

/**
 * Walk GraphProto, returning its declared inputs/outputs and the byte span of
 * every initializer entry (span includes the entry's own tag + length header,
 * measured relative to the start of the graph payload).
 */
function parseGraph(buf, payloadStart, length) {
  const c = reader(buf, payloadStart, payloadStart + length);
  const inputs = [];
  const outputs = [];
  const initializers = [];
  while (c.pos < c.end) {
    const entryStart = c.pos;
    const { field, wire } = readTag(c);
    if (field === 11 && wire === 2) {
      const v = parseValueInfo(subMessage(c));
      if (v) inputs.push(v);
    } else if (field === 12 && wire === 2) {
      const v = parseValueInfo(subMessage(c));
      if (v) outputs.push(v);
    } else if (field === 5 && wire === 2) {
      const name = parseTensorName(subMessage(c));
      initializers.push({ name, start: entryStart, end: c.pos });
    } else {
      skipField(c, wire);
    }
  }
  return { inputs, outputs, initializers };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { model: null, out: null, inPlace: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in-place') args.inPlace = true;
    else if (a === '-o' || a === '--out') args.out = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else if (!args.model) args.model = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  return args;
}

const USAGE = `usage: npm run prepare:model -- <model.onnx> [-o OUT.onnx | --in-place]

Promotes a detector graph's optional scalar int64 length input to a required
input, so onnxruntime-react-native's Android bridge will feed it.
Default output is <model>.app.onnx alongside the input.`;

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    return 2;
  }

  if (args.help || !args.model) {
    console.log(USAGE);
    return args.model ? 0 : 2;
  }
  if (args.inPlace && args.out) {
    console.error('--in-place and --out are mutually exclusive');
    return 2;
  }
  if (!existsSync(args.model)) {
    console.error(`${args.model} does not exist`);
    return 2;
  }

  const out = args.inPlace
    ? args.model
    : (args.out ?? args.model.replace(/(\.onnx)?$/i, '.app.onnx'));

  const buf = readFileSync(args.model);
  const graph = locateGraph(buf);
  const { inputs, outputs, initializers } = parseGraph(buf, graph.payloadStart, graph.length);

  const initByName = new Map(initializers.filter((i) => i.name).map((i) => [i.name, i]));

  const describe = (v) =>
    `${v.name} ${v.elemType === ELEM_FLOAT32 ? 'float32' : v.elemType === ELEM_INT64 ? 'int64' : `elem${v.elemType}`}` +
    `[${v.dims.map((d) => (d === null ? '?' : d)).join(',')}]`;

  console.log(`${basename(args.model)}`);
  console.log(`  graph inputs : ${inputs.map(describe).join(', ')}`);
  console.log(`  graph outputs: ${outputs.map(describe).join(', ')}`);

  // The targets: scalar int64 graph inputs that an initializer supplies a
  // default for. Matched on dtype and rank, never on the name, so a renamed
  // length input in a future export still gets picked up.
  const targets = inputs.filter(
    (v) => v.elemType === ELEM_INT64 && v.dims.length === 0 && initByName.has(v.name),
  );

  if (targets.length === 0) {
    console.log('  nothing to do: no initializer-backed scalar int64 input.');
    console.log('  (already prepared, or this export has no optional length input)');
    if (out !== args.model) {
      writeFileSync(out, buf);
      console.log(`  copied unchanged -> ${out}`);
    }
    return 0;
  }

  // Splice out each target initializer entry, then rewrite GraphProto's length.
  const spans = targets
    .map((t) => initByName.get(t.name))
    .sort((a, b) => a.start - b.start);

  const pieces = [];
  let cursor = graph.payloadStart;
  for (const span of spans) {
    pieces.push(buf.subarray(cursor, span.start));
    cursor = span.end;
  }
  pieces.push(buf.subarray(cursor, graph.payloadStart + graph.length));

  const newPayload = Buffer.concat(pieces);
  const removedBytes = graph.length - newPayload.length;

  const result = Buffer.concat([
    buf.subarray(0, graph.headerStart),
    Buffer.from([0x3a]), // field 7, wire type 2
    encodeVarint(newPayload.length),
    newPayload,
    buf.subarray(graph.payloadStart + graph.length),
  ]);

  writeFileSync(out, result);
  console.log(
    `  promoted ${targets.map((t) => t.name).join(', ')} to required input(s) ` +
      `(${spans.length} initializer(s), ${removedBytes} bytes removed)`,
  );
  console.log(`  wrote ${out}`);

  await verify(args.model, out, targets.map((t) => t.name));
  return 0;
}

/**
 * Confirm the prepared graph (a) loads, (b) now declares the promoted inputs,
 * (c) is mathematically the same graph as the original, and (d) actually
 * responds to the length input now.
 *
 * (c) needs care. The obvious check -- feed both graphs the same length and
 * compare -- does not work from JavaScript, because the JS bindings drop a feed
 * key that is not a declared session input. On the *original* graph
 * `n_samples` is an overridable initializer, so passing it is silently ignored
 * and the original always scores at its default length. (That is the entire bug
 * this script exists to fix; onnxruntime-node reproduces it exactly, which is a
 * useful independent confirmation of the diagnosis.)
 *
 * So equivalence is checked at the one operating point both graphs can express:
 * the original with no length at all (its default = the full buffer) against the
 * prepared graph with the length set explicitly to the full buffer. Those must
 * agree bit-for-bit, which is what proves the byte splice left the math alone.
 *
 * Skipped rather than fatal if onnxruntime-node is unavailable, so preparing a
 * model never hard-depends on an optional dev dependency.
 */
async function verify(originalPath, preparedPath, promoted) {
  let ort;
  try {
    ort = await import('onnxruntime-node');
    ort = ort.default ?? ort;
  } catch {
    console.log('  onnxruntime-node not available -- skipped verification.');
    console.log('  Verify on device: the app logs the resolved graph signature at startup.');
    return;
  }

  const before = await ort.InferenceSession.create(originalPath);
  const after = await ort.InferenceSession.create(preparedPath);

  console.log(`  session inputs before: ${before.inputNames.join(', ')}`);
  console.log(`  session inputs after : ${after.inputNames.join(', ')}`);

  const missing = promoted.filter((n) => !after.inputNames.includes(n));
  if (missing.length) {
    console.error(`  FAILED: ${missing.join(', ')} still not a session input`);
    process.exitCode = 1;
    return;
  }

  // Same pseudo-random waveform through both graphs, length supplied to each.
  const waveInput = after.inputNames.find((n) => !promoted.includes(n));
  const clipSamples = Number(
    // inputMetadata is available in onnxruntime-node; fall back to the graph parse.
    after.inputMetadata?.find?.((m) => m.name === waveInput)?.shape?.[0] ??
      graphWaveLength(preparedPath, waveInput),
  );

  const makeWave = (seedInit) => {
    let seed = seedInit;
    const wave = new Float32Array(clipSamples);
    for (let i = 0; i < clipSamples; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      wave[i] = (seed / 2147483648) * 2 - 1;
    }
    return wave;
  };
  const probOf = (out) => Number(Object.values(out)[0].data[0]);
  const lengthFeeds = (n) =>
    Object.fromEntries(
      promoted.map((name) => [name, new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), [])]),
    );

  // (c) same graph: original at its default length vs prepared told that length.
  let worst = 0;
  for (const seed of [12345, 999331, 5150]) {
    const wave = makeWave(seed);
    const tensor = () => new ort.Tensor('float32', wave.slice(), [clipSamples]);
    const pa = probOf(await before.run({ [waveInput]: tensor() }));
    const pb = probOf(await after.run({ [waveInput]: tensor(), ...lengthFeeds(clipSamples) }));
    worst = Math.max(worst, Math.abs(pa - pb));
    console.log(
      `  full buffer, seed ${seed}: original ${pa.toFixed(10)}  ` +
        `prepared ${pb.toFixed(10)}  diff ${Math.abs(pa - pb).toExponential(1)}`,
    );
  }

  if (worst === 0) {
    console.log('  graph unchanged: bit-identical at the default length (max abs diff 0.0e+00).');
  } else if (worst < 1e-6) {
    console.log(`  graph unchanged: equivalent at the default length (max abs diff ${worst.toExponential(1)}).`);
  } else {
    console.error(`  FAILED: the splice changed the graph (disagreement ${worst.toExponential(1)})`);
    process.exitCode = 1;
    return;
  }

  // (d) the length input is now live -- a shorter length must change the answer,
  // otherwise the mask is still not reaching the pooling and nothing was gained.
  const wave = makeWave(24680);
  const partial = new Float32Array(clipSamples);
  const nReal = Math.max(1, Math.floor(clipSamples * 0.1));
  partial.set(wave.subarray(0, nReal));
  const atFull = probOf(
    await after.run({
      [waveInput]: new ort.Tensor('float32', partial.slice(), [clipSamples]),
      ...lengthFeeds(clipSamples),
    }),
  );
  const atReal = probOf(
    await after.run({
      [waveInput]: new ort.Tensor('float32', partial.slice(), [clipSamples]),
      ...lengthFeeds(nReal),
    }),
  );
  console.log(
    `  length input live: same buffer scored ${atFull.toFixed(10)} at n=${clipSamples} ` +
      `vs ${atReal.toFixed(10)} at n=${nReal} (delta ${Math.abs(atFull - atReal).toExponential(1)})`,
  );
  if (atFull === atReal) {
    console.error('  FAILED: the length input has no effect -- the mask is not wired through');
    process.exitCode = 1;
    return;
  }

  // (b2) and it can no longer be skipped by accident.
  try {
    await after.run({ [waveInput]: new ort.Tensor('float32', wave.slice(), [clipSamples]) });
    console.error(`  FAILED: prepared graph still ran without ${promoted.join(', ')}`);
    process.exitCode = 1;
  } catch {
    console.log(`  ${promoted.join(', ')} is now required -- it can no longer be silently dropped.`);
  }
}

function graphWaveLength(path, name) {
  const buf = readFileSync(path);
  const g = locateGraph(buf);
  const { inputs } = parseGraph(buf, g.payloadStart, g.length);
  const v = inputs.find((i) => i.name === name);
  return v?.dims?.[0] ?? 0;
}

main(process.argv.slice(2)).then((code) => {
  if (code) process.exitCode = code;
});
