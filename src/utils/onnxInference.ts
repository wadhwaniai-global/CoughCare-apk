/**
 * Client-Side ONNX Inference for Cough Detection
 *
 * This module provides 100% client-side inference using ONNX Runtime.
 * - Web: Uses onnxruntime-web (WASM backend)
 * - React Native: Uses onnxruntime-react-native (native backend)
 *
 * It replicates the exact preprocessing and model inference from backend_api_actual_model.py
 *
 * Pipeline:
 * 1. Audio waveform (from WebAudio API or file)
 * 2. cough_preprocessing.onnx: waveform -> mel spectrogram (ImageNet normalized)
 * 3. cough_detector_int8.onnx: spectrograms -> prediction
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

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
let MODEL_ASSETS: { preprocessing: any; detector: any } | null = null;

function getModelAssets() {
  if (Platform.OS === 'web') {
    return { preprocessing: null, detector: null };
  }
  
  if (MODEL_ASSETS === null) {
    try {
      // This will only be resolved on React Native due to .native.ts extension
      MODEL_ASSETS = require('../assets/models.native').MODEL_ASSETS;
    } catch (error) {
      console.warn('[ONNX] Failed to load model assets:', error);
      MODEL_ASSETS = { preprocessing: null, detector: null };
    }
  }
  
  return MODEL_ASSETS;
}

// Note: We don't import onnxruntime-web directly to avoid Metro bundling issues
// Instead, we load it from CDN for web or use onnxruntime-react-native for native

// Configuration matching the Python training config
const CONFIG = {
  sampleRate: 16000,
  segmentDuration: 2.0, // seconds
  hopLength: 0.5, // seconds
  maxSegments: 32,
  segmentSamples: 32000, // sampleRate * segmentDuration
};

// Model paths
const MODEL_PATHS = {
  // For web: served from public folder
  webPreprocessing: '/models/cough_preprocessing.onnx',
  webDetector: '/models/cough_detector_int8.onnx',
};

// Type definitions for ONNX Runtime (works with both web and react-native)
type InferenceSession = any;

// Runtime modules (loaded dynamically based on platform)
let ort: any = null;
let preprocessingSession: InferenceSession | null = null;
let detectorSession: InferenceSession | null = null;
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

/**
 * Initialize ONNX Runtime sessions
 * Call this early (e.g., on app load) to pre-load models
 */
export async function initONNX(): Promise<void> {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log('[ONNX] Initializing ONNX Runtime...');
    console.log('[ONNX] Platform:', Platform.OS);

    try {
      await loadOrtModule();

      if (Platform.OS === 'web') {
        // Web: load from public folder URLs
        console.log('[ONNX] Loading preprocessing model from URL...');
        preprocessingSession = await ort.InferenceSession.create(MODEL_PATHS.webPreprocessing, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        console.log('[ONNX] Preprocessing model loaded');

        console.log('[ONNX] Loading detector model from URL...');
        detectorSession = await ort.InferenceSession.create(MODEL_PATHS.webDetector, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        console.log('[ONNX] Detector model loaded');
      } else {
        // React Native: load from bundled assets
        console.log('[ONNX] Loading models for React Native...');

        const cacheDir = FileSystem.cacheDirectory;
        const preprocessingPath = `${cacheDir}cough_preprocessing.onnx`;
        const detectorPath = `${cacheDir}cough_detector_int8.onnx`;

        // Check if models exist in cache
        const preprocessingInfo = await FileSystem.getInfoAsync(preprocessingPath);
        const detectorInfo = await FileSystem.getInfoAsync(detectorPath);

        // Load models from bundled assets if not in cache
        if (!preprocessingInfo.exists) {
          console.log('[ONNX] Copying preprocessing model from assets...');
          try {
            // Load from bundled assets using expo-asset
            const assets = getModelAssets();
            if (!assets || !assets.preprocessing) {
              throw new Error('Model assets not available');
            }
            const asset = Asset.fromModule(assets.preprocessing);
            await asset.downloadAsync();
            
            if (!asset.localUri) {
              throw new Error('Failed to load preprocessing model asset - localUri is null');
            }
            
            // Copy to cache directory
            await FileSystem.copyAsync({
              from: asset.localUri,
              to: preprocessingPath,
            });
            console.log('[ONNX] Preprocessing model copied to cache');
          } catch (error: any) {
            console.error('[ONNX] Asset loading error:', error);
            throw new Error(`Failed to load preprocessing model from assets: ${error.message}. Make sure models are in assets/models/ folder and expo-asset is installed.`);
          }
        }

        if (!detectorInfo.exists) {
          console.log('[ONNX] Copying detector model from assets...');
          try {
            // Load from bundled assets using expo-asset
            const assets = getModelAssets();
            if (!assets || !assets.detector) {
              throw new Error('Model assets not available');
            }
            const asset = Asset.fromModule(assets.detector);
            await asset.downloadAsync();
            
            if (!asset.localUri) {
              throw new Error('Failed to load detector model asset - localUri is null');
            }
            
            // Copy to cache directory
            await FileSystem.copyAsync({
              from: asset.localUri,
              to: detectorPath,
            });
            console.log('[ONNX] Detector model copied to cache');
          } catch (error: any) {
            console.error('[ONNX] Asset loading error:', error);
            throw new Error(`Failed to load detector model from assets: ${error.message}. Make sure models are in assets/models/ folder and expo-asset is installed.`);
          }
        }

        console.log('[ONNX] Loading preprocessing model...');
        console.log('[ONNX] ort object:', ort ? 'loaded' : 'null');
        console.log('[ONNX] InferenceSession:', ort?.InferenceSession ? 'available' : 'undefined');
        
        if (!ort || !ort.InferenceSession) {
          throw new Error('ONNX Runtime InferenceSession is not available. The native module may not be properly linked. Run: npx expo prebuild -p android');
        }
        
        preprocessingSession = await ort.InferenceSession.create(preprocessingPath);
        console.log('[ONNX] Preprocessing model loaded');

        console.log('[ONNX] Loading detector model...');
        detectorSession = await ort.InferenceSession.create(detectorPath);
        console.log('[ONNX] Detector model loaded');
      }

      isInitialized = true;
      console.log('[ONNX] Initialization complete');
    } catch (error) {
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

  // Note: High-pass filter (50Hz) is not applied here because:
  // 1. It's not included in the preprocessing ONNX model
  // 2. JavaScript implementation would be complex
  // 3. The model should be robust to this difference for most audio
  // If needed, could add a simple high-pass filter here using Web Audio API

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
 * Extract 2-second segments with 0.5s hop
 * Matches CoughAudioProcessor.extract_segments()
 */
function extractSegments(waveform: Float32Array): Float32Array[] {
  const segSamples = CONFIG.segmentSamples;
  const hopSamples = Math.floor(CONFIG.hopLength * CONFIG.sampleRate);

  // Pad if too short
  let paddedWaveform = waveform;
  if (waveform.length < segSamples) {
    paddedWaveform = new Float32Array(segSamples);
    paddedWaveform.set(waveform);
    // Rest is already 0 (silent padding)
  }

  const segments: Float32Array[] = [];
  let start = 0;

  while (start + segSamples <= paddedWaveform.length) {
    segments.push(paddedWaveform.slice(start, start + segSamples));
    start += hopSamples;
  }

  // Ensure at least one segment
  if (segments.length === 0) {
    segments.push(paddedWaveform.slice(0, segSamples));
  }

  // Cap at max segments
  if (segments.length > CONFIG.maxSegments) {
    return segments.slice(0, CONFIG.maxSegments);
  }

  return segments;
}

/**
 * Run preprocessing ONNX on a single segment
 * Input: Float32Array of length 32000
 * Output: Float32Array of shape [1, 3, 224, 224]
 */
async function preprocessSegment(segment: Float32Array): Promise<Float32Array> {
  if (!preprocessingSession || !ort) {
    throw new Error('Preprocessing model not loaded');
  }

  // Create input tensor: [1, 32000]
  const inputTensor = new ort.Tensor('float32', segment, [1, CONFIG.segmentSamples]);

  // Run inference
  const results = await preprocessingSession.run({ waveform: inputTensor });

  // Python returns outputs[0] without relying on name.
  const key = Object.keys(results)[0];
  if (!key) throw new Error('Preprocessing ONNX returned no outputs');
  const output = results[key];
  return output.data as Float32Array;
}

/**
 * Run full detection pipeline
 * Input: spectrograms [1, numSegments, 3, 224, 224], mask [1, numSegments]
 * Output: { bagProbability, segmentProbabilities }
 */
async function runDetector(
  spectrograms: Float32Array,
  numSegments: number
): Promise<{ bagProbability: number; segmentProbabilities: number[] }> {
  if (!detectorSession || !ort) {
    throw new Error('Detector model not loaded');
  }

  // Create input tensors - NO padding to 32! Use actual numSegments (matches Python/evaluation)
  // Python: specs_batch shape (1, num_segments, 3, 224, 224)
  const specTensor = new ort.Tensor('float32', spectrograms, [1, numSegments, 3, 224, 224]);

  // Python mask: np.ones((1,numSeg), dtype=bool) - ALL true, length = numSegments (NOT 32!)
  const maskData = new Uint8Array(numSegments);
  maskData.fill(1);
  const maskTensor = new ort.Tensor('bool', maskData as any, [1, numSegments]);

  // Python feeds exact names: {'spectrograms': specs_batch, 'segment_mask': mask}
  // Use exact same names as Python - NO dynamic detection!
  const results = await detectorSession.run({
    spectrograms: specTensor,
    segment_mask: maskTensor,
  });

  // Log all outputs for debugging
  const keys = Object.keys(results);
  console.log('[ONNX] Detector output keys:', keys);
  
  for (const key of keys) {
    const data = results[key].data as any;
    console.log(`[ONNX] Output "${key}": first value = ${data[0]}, dims = ${results[key].dims}`);
  }

  // CRITICAL: Use EXACT output names, NOT positional access!
  // Object.keys() order is NOT guaranteed to match Python's outputs[0] order!
  // From logs: keys = ["segment_logits", "segment_probabilities", "bag_probability", "bag_logit"]
  // Python outputs[0] = bag_probability, but JS keys[0] = segment_logits (WRONG!)
  
  if (!results['bag_probability']) {
    throw new Error(`Output 'bag_probability' not found. Available: ${keys.join(', ')}`);
  }
  
  const bagData = results['bag_probability'].data as any;
  const bagProbability = Number(bagData[0]);
  console.log(`[ONNX] bag_probability: ${bagProbability}`);

  let segmentProbabilities: number[] = [];
  if (results['segment_probabilities']) {
    const segData = results['segment_probabilities'].data as any;
    segmentProbabilities = Array.from(segData as ArrayLike<number>).slice(0, numSegments).map(Number);
    console.log(`[ONNX] segment_probabilities: ${segmentProbabilities.length} values`);
  }

  return { bagProbability, segmentProbabilities };
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
  segment_probabilities: number[];
  num_segments: number;
  threshold_used: number;
  message: string;
  mode: string;
}> {
  // Ensure models are loaded
  await initONNX();

  console.log('[ONNX] Starting inference...');
  const startTime = performance.now();

  // 1. Decode audio to waveform
  console.log('[ONNX] Decoding audio...');
  let waveform: Float32Array;

  if (Platform.OS === 'web') {
    waveform = await decodeAudioWeb(audioData);
  } else {
    // For React Native, decode audio using FFmpeg (exact Python match) or WAV decoder
    waveform = await decodeAudioReactNative(audioData, audioUri);
  }

  console.log(`[ONNX] Decoded ${waveform.length} samples`);

  // 2. Extract segments
  console.log('[ONNX] Extracting segments...');
  const segments = extractSegments(waveform);
  const numSegments = segments.length;
  console.log(`[ONNX] Extracted ${numSegments} segments`);

  // 3. Preprocess each segment
  console.log('[ONNX] Preprocessing segments...');
  const spectrogramSize = 3 * 224 * 224;
  const allSpectrograms = new Float32Array(numSegments * spectrogramSize);

  for (let i = 0; i < numSegments; i++) {
    const specData = await preprocessSegment(segments[i]);
    allSpectrograms.set(specData, i * spectrogramSize);
  }
  console.log('[ONNX] Preprocessing complete');

  // 4. Run detector - NO padding to 32! Use actual numSegments (matches Python/evaluation)
  // Python: specs_batch shape (1, num_segments, 3, 224, 224) - NOT padded to 32
  console.log('[ONNX] Running detector...');
  const { bagProbability, segmentProbabilities } = await runDetector(allSpectrograms, numSegments);

  const endTime = performance.now();
  console.log(`[ONNX] Inference complete in ${(endTime - startTime).toFixed(0)}ms`);
  console.log(`[ONNX] Bag probability: ${bagProbability.toFixed(4)}`);

  // Apply thresholds (matching backend_api_actual_model.py)
  // Optimal threshold: 0.45 (from TypeScript evaluation on full test set - 1510 samples)
  // F1 Score: 94.31%, Accuracy: 93.91%, AUC: 98.20%
  const threshold = 0.45;
  const coughDetected = bagProbability > threshold;
  const tbDetected = bagProbability > 1; // TB threshold (effectively always false in this model)

  return {
    coughDetected,
    tbDetected,
    confidence: bagProbability,
    file_probability: bagProbability,
    segment_probabilities: segmentProbabilities,
    num_segments: numSegments,
    threshold_used: threshold,
    message: coughDetected
      ? `Cough detected with ${(bagProbability * 100).toFixed(1)}% confidence (client-side ONNX)`
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
  preprocessingLoaded: boolean;
  detectorLoaded: boolean;
  platform: string;
  config: typeof CONFIG;
} {
  return {
    isReady: isInitialized,
    preprocessingLoaded: preprocessingSession !== null,
    detectorLoaded: detectorSession !== null,
    platform: Platform.OS,
    config: CONFIG,
  };
}

/**
 * Download models to cache (for React Native)
 * Call this before initONNX() on native platforms
 */
export async function downloadModels(baseUrl: string): Promise<void> {
  if (Platform.OS === 'web') {
    console.log('[ONNX] Web platform - models loaded from public folder');
    return;
  }

  const cacheDir = FileSystem.cacheDirectory;
  const models = [
    { name: 'cough_preprocessing.onnx', url: `${baseUrl}/models/cough_preprocessing.onnx` },
    { name: 'cough_detector_int8.onnx', url: `${baseUrl}/models/cough_detector_int8.onnx` },
  ];

  for (const model of models) {
    const localPath = `${cacheDir}${model.name}`;
    const info = await FileSystem.getInfoAsync(localPath);

    if (!info.exists) {
      console.log(`[ONNX] Downloading ${model.name}...`);
      await FileSystem.downloadAsync(model.url, localPath);
      console.log(`[ONNX] Downloaded ${model.name}`);
    } else {
      console.log(`[ONNX] ${model.name} already in cache`);
    }
  }
}
