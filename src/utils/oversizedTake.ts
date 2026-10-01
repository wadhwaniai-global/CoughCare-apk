/**
 * Uploading takes that are too large for the server.
 *
 * The server refuses any single file over 25 MiB (cough_backend
 * app/routers/files.py MAX_UPLOAD_BYTES; "File too large") and any request
 * over 30 MiB ("Request body too large", app/main.py MAX_BODY_BYTES). A take
 * is 48 kHz mono 16-bit, 96,000 bytes a second, so 25 MiB is about 4.5
 * minutes. Takes are meant to stop at 60 s, but builds up to 2026-10 could
 * keep recording for minutes when the app left the screen or Section D was
 * closed during a take. One such file then failed every sync of its record,
 * forever, whether it was a kept or a discarded take (field report
 * 2026-09-30, "Failed to upload file: Request body too large").
 *
 * Such a take is uploaded as its first 60 s: the recording cap, and exactly
 * the audio the on-device cough score was computed on (the detector's buffer
 * is 60 s at 16 kHz). The original stays on the phone until the record is
 * purged after a successful sync, and the form's recordings[] entry carries
 * upload_trimmed_to_seconds and original_file_bytes so the server data says
 * what happened.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

/** cough_backend app/routers/files.py MAX_UPLOAD_BYTES */
export const SERVER_MAX_FILE_BYTES = 25 * 1024 * 1024;
/** The recording cap and the cough detector's buffer length */
export const UPLOAD_TRIM_SECONDS = 60;

// Read defensively, as audioQuality.ts does: this runs when SyncService is
// imported at startup, where a throw would stop the app from opening
const B64 = ((FileSystem as any).EncodingType?.Base64 || 'base64') as any;

export interface PreparedUpload {
  /** The file to upload: the take itself, or a trimmed copy in the cache */
  uri: string;
  /** True for a trimmed copy, which the caller deletes after the upload */
  temporary: boolean;
}

interface WavLayout {
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  dataStart: number;
  dataLen: number;
}

/** Locate fmt and data in a 16-bit PCM WAV (any chunk order, LIST allowed). */
async function readWavLayout(uri: string): Promise<WavLayout | null> {
  const head = Buffer.from(
    await FileSystem.readAsStringAsync(uri, { encoding: B64, position: 0, length: 512 }),
    'base64'
  );
  if (head.length < 44 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let pos = 12;
  let fmt: { format: number; channels: number; sampleRate: number; byteRate: number; blockAlign: number; bits: number } | null = null;
  while (pos + 8 <= head.length) {
    const id = head.toString('ascii', pos, pos + 4);
    const size = head.readUInt32LE(pos + 4);
    if (id === 'fmt ' && pos + 24 <= head.length) {
      fmt = {
        format: head.readUInt16LE(pos + 8),
        channels: head.readUInt16LE(pos + 10),
        sampleRate: head.readUInt32LE(pos + 12),
        byteRate: head.readUInt32LE(pos + 16),
        blockAlign: head.readUInt16LE(pos + 20),
        bits: head.readUInt16LE(pos + 22),
      };
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.byteRate !== fmt.sampleRate * fmt.channels * 2) {
        return null;
      }
      return {
        channels: fmt.channels,
        sampleRate: fmt.sampleRate,
        byteRate: fmt.byteRate,
        blockAlign: fmt.blockAlign,
        dataStart: pos + 8,
        dataLen: size,
      };
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

/** The same 44-byte header react-native-audio-record writes (addWavHeader). */
function canonicalHeader(layout: WavLayout, dataLen: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataLen, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(layout.channels, 22);
  h.writeUInt32LE(layout.sampleRate, 24);
  h.writeUInt32LE(layout.byteRate, 28);
  h.writeUInt16LE(layout.blockAlign, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataLen, 40);
  return h;
}

/** Copy the first `keep` bytes of PCM behind a fresh header (one partial read). */
async function trimWithJs(inUri: string, outUri: string, layout: WavLayout, keep: number): Promise<void> {
  const pcm = Buffer.from(
    await FileSystem.readAsStringAsync(inUri, { encoding: B64, position: layout.dataStart, length: keep }),
    'base64'
  );
  if (pcm.length !== keep) {
    throw new Error(`short read (${pcm.length} of ${keep} bytes)`);
  }
  await FileSystem.writeAsStringAsync(
    outUri,
    Buffer.concat([canonicalHeader(layout, keep), pcm]).toString('base64'),
    { encoding: B64 }
  );
}

/** Fallback for files the JS path cannot parse. */
async function trimWithFFmpeg(inUri: string, outUri: string): Promise<void> {
  if (Platform.OS === 'web') throw new Error('FFmpeg not available on web');
  const { FFmpegKit } = require('ffmpeg-kit-react-native');
  const path = (uri: string) => (uri.startsWith('file://') ? uri.substring(7) : uri);
  const session = await FFmpegKit.execute(
    `-hide_banner -y -i "${path(inUri)}" -t ${UPLOAD_TRIM_SECONDS} -c:a pcm_s16le ` +
    `-map_metadata -1 -fflags +bitexact -flags:a +bitexact "${path(outUri)}"`
  );
  const returnCode = await session.getReturnCode();
  if (!returnCode?.isValueSuccess()) {
    throw new Error('FFmpeg did not finish');
  }
}

/** The trimmed copy is a valid WAV under the server limit, holding what we meant to keep. */
async function verifyTrimmed(outUri: string, keep: number | null): Promise<boolean> {
  const info: any = await FileSystem.getInfoAsync(outUri);
  if (!info.exists) return false;
  const layout = await readWavLayout(outUri);
  return !!layout
    && info.size <= SERVER_MAX_FILE_BYTES
    && info.size === layout.dataStart + layout.dataLen
    && (keep === null
      ? layout.dataLen <= (UPLOAD_TRIM_SECONDS + 1) * layout.byteRate
      : layout.dataLen === keep);
}

/**
 * The file to upload for a take: the take itself when it fits the server's
 * limit, otherwise a copy of its first 60 s. Throws with a plain message when
 * the take cannot be shortened (the record then stays pending, untouched).
 */
export async function prepareTakeForUpload(uri: string): Promise<PreparedUpload> {
  const info: any = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    throw new Error(`File not found: ${uri}`);
  }
  const size: number = info.size ?? 0;
  if (size <= SERVER_MAX_FILE_BYTES) {
    return { uri, temporary: false };
  }

  const out = `${FileSystem.cacheDirectory}upload_trim_${Date.now()}.wav`;
  const layout = await readWavLayout(uri);
  const keep = layout
    ? Math.min(layout.dataLen || Infinity, size - layout.dataStart, UPLOAD_TRIM_SECONDS * layout.byteRate)
    : null;

  // Every take this app records is a plain 44-byte-header WAV, so the exact
  // JS slice always applies; FFmpeg only handles a file it cannot parse.
  const attempts: Array<[string, () => Promise<void>]> = [];
  if (layout && keep) attempts.push(['js', () => trimWithJs(uri, out, layout, keep)]);
  attempts.push(['ffmpeg', () => trimWithFFmpeg(uri, out)]);

  for (const [method, run] of attempts) {
    try {
      await run();
      if (await verifyTrimmed(out, keep)) {
        console.log(`[Upload] Take of ${size} bytes trimmed to its first ${UPLOAD_TRIM_SECONDS} s (${method}): ${uri}`);
        return { uri: out, temporary: true };
      }
      console.warn(`[Upload] ${method} trim produced an invalid file for ${uri}`);
    } catch (error) {
      console.warn(`[Upload] ${method} trim failed for ${uri}:`, error);
    }
    await FileSystem.deleteAsync(out, { idempotent: true }).catch(() => {});
  }
  throw new Error('One recording is too long to upload and could not be shortened. Keep this record on the phone and tell your supervisor.');
}

/** recordings[] keys for a take that is uploaded trimmed (empty otherwise). */
export async function uploadTrimFlags(uri: string): Promise<{ upload_trimmed_to_seconds?: number; original_file_bytes?: number }> {
  try {
    const info: any = await FileSystem.getInfoAsync(uri);
    if (info.exists && (info.size ?? 0) > SERVER_MAX_FILE_BYTES) {
      return { upload_trimmed_to_seconds: UPLOAD_TRIM_SECONDS, original_file_bytes: info.size };
    }
  } catch (error) {
    console.warn('[Upload] Could not read the take size:', error);
  }
  return {};
}
