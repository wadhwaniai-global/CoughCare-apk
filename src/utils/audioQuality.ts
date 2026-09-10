/**
 * Per-take audio quality metrics.
 *
 * Computed on the phone right after a take is stopped and uploaded inside
 * form_data.recordings[].quality. They exist so the dashboard can spot a
 * device model whose microphone path misbehaves (gain control, clipping,
 * a quiet path, or the record-start dead time found on the Galaxy A07)
 * without anyone having to listen to or reprocess the WAVs.
 *
 * Ground truth for what these look like on a known-good device is in the
 * capture analysis of 2026-09-10 (Galaxy A07, MIC, quiet room): peak about
 * -6 dBFS on a close cough, noise floor -70 to -75 dBFS, no clipping,
 * leading zeros 0 to 1.3 s, file a little longer than wall clock by the
 * zero padding. VOICE_RECOGNITION on the same phone: floor -43 dBFS.
 *
 * Everything here is fail-safe: computeAudioQuality never throws, it
 * returns null, and a null must never block saving or syncing a take.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

export interface AudioQuality {
  /** schema version of this object */
  v: 1;
  sample_rate: number;
  /** audio length implied by the file (samples / sample_rate), seconds */
  file_seconds: number;
  /** how long the recorder actually ran, seconds; null if unknown */
  wall_seconds: number | null;
  /** exact-zero samples at the start of the file, seconds. The platform
   *  pads the file while the input is still starting up (Galaxy A07: the
   *  record track is torn down and re-created about a second after start). */
  leading_zero_seconds: number;
  /** total length of exact-zero runs of 20 ms or more after the leading
   *  block, seconds; dropouts / buffer underruns */
  interior_zero_seconds: number;
  /** loudest sample, dBFS; null if there is no real audio */
  peak_dbfs: number | null;
  /** RMS over the real audio (leading zeros excluded), dBFS */
  rms_dbfs: number | null;
  /** fraction of real-audio samples at full scale (saturation) */
  clipped_ratio: number;
  /** 10th percentile of 20 ms frame RMS over the real audio, dBFS: the
   *  quiet-frame level, i.e. the noise floor */
  noise_floor_dbfs: number | null;
  /** noise floor of the first quarter of the real audio */
  floor_pre_dbfs: number | null;
  /** noise floor of the last quarter of the real audio. A floor that rises
   *  or falls by many dB across a take is the field-visible sign of
   *  automatic gain control / compression pumping. */
  floor_post_dbfs: number | null;
}

const FRAME_SECONDS = 0.02;
const MIN_ZERO_RUN_SECONDS = 0.02;
const FULL_SCALE = 32768;
/** below this much real audio the floor statistics are meaningless */
const MIN_REAL_SECONDS_FOR_FLOORS = 0.5;

const round = (x: number, places: number) => {
  const f = Math.pow(10, places);
  return Math.round(x * f) / f;
};
const toDb = (linear: number): number | null =>
  linear > 0 ? round(20 * Math.log10(linear / FULL_SCALE), 1) : null;

const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
};

/** Pure metric computation over 16-bit mono PCM. Exported for testing. */
export function analyzePcm16(pcm: Int16Array, sampleRate: number, wallSeconds?: number | null): AudioQuality {
  const n = pcm.length;

  // Leading block of exact zeros
  let lead = 0;
  while (lead < n && pcm[lead] === 0) lead++;

  const realCount = n - lead;
  let peak = 0;
  let sumSq = 0;
  let clipped = 0;
  let interiorZero = 0;
  let zeroRun = 0;
  const minZeroRun = Math.round(MIN_ZERO_RUN_SECONDS * sampleRate);

  for (let i = lead; i < n; i++) {
    const s = pcm[i];
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
    if (a >= FULL_SCALE - 1) clipped++;
    sumSq += s * s;
    if (s === 0) {
      zeroRun++;
    } else {
      if (zeroRun >= minZeroRun) interiorZero += zeroRun;
      zeroRun = 0;
    }
  }
  if (zeroRun >= minZeroRun) interiorZero += zeroRun;

  // 20 ms frame RMS over the real audio, for floor statistics
  const frameLen = Math.round(FRAME_SECONDS * sampleRate);
  const frameRms: number[] = [];
  if (realCount >= MIN_REAL_SECONDS_FOR_FLOORS * sampleRate && frameLen > 0) {
    for (let start = lead; start + frameLen <= n; start += frameLen) {
      let acc = 0;
      for (let j = start; j < start + frameLen; j++) acc += pcm[j] * pcm[j];
      // Exact-zero frames are dropouts (counted in interior_zero_seconds),
      // not quiet room: leaving them in would pin the floor at -infinity.
      if (acc > 0) frameRms.push(Math.sqrt(acc / frameLen));
    }
  }
  const quarter = Math.floor(frameRms.length / 4);
  const pre = quarter > 0 ? frameRms.slice(0, quarter) : [];
  const post = quarter > 0 ? frameRms.slice(frameRms.length - quarter) : [];

  const floorOf = (frames: number[]) => {
    const p10 = percentile(frames, 0.1);
    return p10 === null ? null : toDb(p10);
  };

  return {
    v: 1,
    sample_rate: sampleRate,
    file_seconds: round(n / sampleRate, 2),
    wall_seconds: wallSeconds == null || !isFinite(wallSeconds) ? null : round(wallSeconds, 2),
    leading_zero_seconds: round(lead / sampleRate, 2),
    interior_zero_seconds: round(interiorZero / sampleRate, 2),
    peak_dbfs: realCount > 0 ? toDb(peak) : null,
    rms_dbfs: realCount > 0 ? toDb(Math.sqrt(sumSq / realCount)) : null,
    clipped_ratio: realCount > 0 ? round(clipped / realCount, 5) : 0,
    noise_floor_dbfs: floorOf(frameRms),
    floor_pre_dbfs: floorOf(pre),
    floor_post_dbfs: floorOf(post),
  };
}

/** Locate the PCM payload of a 16-bit PCM WAV. Returns null for anything else. */
export function parseWavPcm16(bytes: Buffer): { pcm: Int16Array; sampleRate: number } | null {
  if (bytes.length < 44) return null;
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return null;

  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  let bitsPerSample = 16;
  let audioFormat = 1;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      audioFormat = bytes.readUInt16LE(offset + 8);
      channels = bytes.readUInt16LE(offset + 10);
      sampleRate = bytes.readUInt32LE(offset + 12);
      bitsPerSample = bytes.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || sampleRate <= 0) return null;
      const dataStart = offset + 8;
      // Some writers leave the size field stale; trust the actual file length.
      const dataLen = Math.min(size, bytes.length - dataStart);
      const sampleCount = Math.floor(dataLen / 2);
      // Int16Array needs 2-byte alignment; copy if the pool slice is odd.
      const absolute = bytes.byteOffset + dataStart;
      const pcm = absolute % 2 === 0
        ? new Int16Array(bytes.buffer, absolute, sampleCount)
        : new Int16Array(Buffer.from(bytes.subarray(dataStart, dataStart + sampleCount * 2)).buffer.slice(0, sampleCount * 2));
      return { pcm, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Read a recorded WAV and compute its quality metrics. Never throws.
 * @param wallSeconds how long the recorder ran, from AudioRecorder.getLastTakeWallSeconds()
 */
export async function computeAudioQuality(uri: string, wallSeconds?: number | null): Promise<AudioQuality | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: ((FileSystem as any).EncodingType?.Base64 || 'base64') as any,
    });
    const parsed = parseWavPcm16(Buffer.from(base64, 'base64'));
    if (!parsed) {
      console.warn('[AudioQuality] not a 16-bit mono PCM WAV, skipping metrics:', uri);
      return null;
    }
    const q = analyzePcm16(parsed.pcm, parsed.sampleRate, wallSeconds);
    console.log('[AudioQuality]', JSON.stringify(q));
    return q;
  } catch (error) {
    console.warn('[AudioQuality] metrics failed (take is still saved):', error);
    return null;
  }
}

/** One-line human summary for diagnostics screens. */
export const describeQuality = (q: AudioQuality | null): string => {
  if (!q) return 'quality: n/a';
  const dbs = (v: number | null) => (v === null ? 'n/a' : `${v} dBFS`);
  return `peak ${dbs(q.peak_dbfs)} · rms ${dbs(q.rms_dbfs)} · floor ${dbs(q.noise_floor_dbfs)} (pre ${dbs(q.floor_pre_dbfs)}, post ${dbs(q.floor_post_dbfs)}) · clipped ${(q.clipped_ratio * 100).toFixed(2)}% · leading zeros ${q.leading_zero_seconds}s · gaps ${q.interior_zero_seconds}s · file ${q.file_seconds}s / wall ${q.wall_seconds ?? 'n/a'}s`;
};
