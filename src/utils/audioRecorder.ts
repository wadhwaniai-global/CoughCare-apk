// Audio Recorder utility
// - Web: Uses MediaRecorder (Web Audio API)
// - Native: Uses react-native-audio-record (16kHz, 16-bit, mono WAV)
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import AudioRecord from 'react-native-audio-record';
import { Buffer } from 'buffer';

export class AudioRecorder {
  private isRecording: boolean = false;
  private recordingUri: string | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  async start(): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        // --- WEB IMPLEMENTATION ---
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mediaRecorder = new MediaRecorder(stream);
        this.audioChunks = [];

        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this.audioChunks.push(event.data);
          }
        };

        this.mediaRecorder.onstop = () => {
          const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
          this.recordingUri = URL.createObjectURL(blob);
        };

        this.mediaRecorder.start();
        this.isRecording = true;
      } else {
        // --- NATIVE IMPLEMENTATION (Android/iOS) ---
        // Using react-native-audio-record for WAV format
        // Configure for 16kHz, mono, 16-bit PCM WAV (Required by ONNX Model)
        
        // Generate unique filename for each recording to prevent overwrites
        const timestamp = Date.now();
        const uniqueFileName = `cough_recording_${timestamp}.wav`;
        
        const options = {
          sampleRate: 16000,  // NON-NEGOTIABLE: 16kHz required by ONNX model
          channels: 1,         // NON-NEGOTIABLE: Mono (1 channel)
          bitsPerSample: 16,  // NON-NEGOTIABLE: 16-bit
          wavFile: uniqueFileName
        };
        
        console.log('[AudioRecorder] Initializing react-native-audio-record with unique filename:', uniqueFileName);
        console.log('[AudioRecorder] Options:', options);
        
        // Initialize with unique filename for each recording
        AudioRecord.init(options);
        
        // Store the expected filename for later verification
        (this as any).expectedFileName = uniqueFileName;
        
        console.log('[AudioRecorder] Starting recording...');
        AudioRecord.start();
        
        this.isRecording = true;
        (this as any).recordingStartTime = timestamp;
        
        console.log('[AudioRecorder] Recording started successfully');
      }
    } catch (error: any) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }

  async stop(): Promise<string> {
    if (!this.isRecording) {
      throw new Error('No active recording');
    }

    if (Platform.OS === 'web') {
      // --- WEB STOP ---
      return new Promise((resolve, reject) => {
        if (!this.mediaRecorder) {
          reject(new Error('No media recorder'));
          return;
        }

        this.mediaRecorder.onstop = () => {
          const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
          const uri = URL.createObjectURL(blob);
          this.recordingUri = uri;
          this.isRecording = false;

          // Stop all tracks
          if (this.mediaRecorder.stream) {
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
          }

          resolve(uri);
        };

        this.mediaRecorder.stop();
      });
    } else {
      // --- NATIVE STOP ---
      try {
        const recordingDuration = (this as any).recordingStartTime 
          ? ((Date.now() - (this as any).recordingStartTime) / 1000).toFixed(1)
          : 'unknown';
        
        console.log(`[AudioRecorder] Stopping recording after ${recordingDuration} seconds...`);
        
        // Stop recording and get file path
        const filePath = await AudioRecord.stop();
        
        if (!filePath) {
          throw new Error('Recording file path is null');
        }
        
        this.isRecording = false;
        const expectedFileName = (this as any).expectedFileName;
        (this as any).recordingStartTime = null;
        (this as any).expectedFileName = null;
        
        // Ensure we have a proper file path
        let finalPath = filePath;
        if (!finalPath.startsWith('file://') && !finalPath.startsWith('/')) {
          finalPath = `file://${finalPath}`;
        } else if (!finalPath.startsWith('file://')) {
          finalPath = `file://${finalPath}`;
        }
        
        this.recordingUri = finalPath;
        console.log('[AudioRecorder] Recording stopped, saved to:', this.recordingUri);
        console.log('[AudioRecorder] Expected filename was:', expectedFileName);
        console.log('[AudioRecorder] Actual file path:', filePath);
        
        // Verify file exists and get info
        try {
          const fileInfo = await FileSystem.getInfoAsync(finalPath);
          if (fileInfo.exists) {
            const actualSize = fileInfo.size || 0;
            const durationNum = typeof recordingDuration === 'string' && recordingDuration !== 'unknown'
              ? parseFloat(recordingDuration)
              : 0;
            
            // Expected size: 16kHz * 2 bytes (16-bit) * 1 channel * seconds + 44 bytes header
            const expectedSizeWAV = durationNum > 0 
              ? Math.round(durationNum * 16000 * 2) + 44
              : 0;
            
            console.log('[AudioRecorder] File verification:');
            console.log('  - Actual size:', actualSize, 'bytes');
            console.log('  - Expected size (WAV, approx):', expectedSizeWAV, 'bytes');
            console.log('  - Duration:', recordingDuration, 'seconds');
            console.log('  - Format: WAV (16kHz, 16-bit, mono PCM)');
            
            if (actualSize === 0) {
              console.warn('[AudioRecorder] ⚠️ WARNING: File size is 0 bytes!');
              console.warn('[AudioRecorder] Recording may have failed.');
            } else if (actualSize < expectedSizeWAV * 0.3) {
              console.warn('[AudioRecorder] ⚠️ WARNING: File size is much smaller than expected!');
              console.warn('[AudioRecorder] This suggests the recording may have been cut off early.');
            } else {
              console.log('[AudioRecorder] ✅ File size looks reasonable for the recording duration.');
            }
          } else {
            console.warn('[AudioRecorder] WARNING: File does not exist at path:', finalPath);
          }
        } catch (infoError) {
          console.warn('[AudioRecorder] Could not verify file info:', infoError);
        }
        
        return this.recordingUri;
      } catch (error) {
        console.error('[AudioRecorder] Error stopping native recording:', error);
        this.isRecording = false;
        (this as any).recordingStartTime = null;
        
        throw error;
      }
    }
  }

  async getBlob(): Promise<Blob> {
    if (!this.recordingUri) {
      throw new Error('No recording available');
    }

    try {
      // Read file as base64
      const base64 = await FileSystem.readAsStringAsync(this.recordingUri, {
        encoding: ((FileSystem as any).EncodingType?.Base64 || 'base64') as any,
      });

      // Convert base64 to blob
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);

      // Determine MIME type
      const mimeType = this.recordingUri.endsWith('.wav') ? 'audio/wav' : 'audio/webm';

      return new Blob([byteArray], { type: mimeType });
    } catch (error) {
      console.error('Error getting blob:', error);
      throw error;
    }
  }

  async getUri(): Promise<string | null> {
    return this.recordingUri;
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }

  async cleanup(): Promise<void> {
    if (Platform.OS === 'web') {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        try {
          this.mediaRecorder.stop();
        } catch (error) { }
      }
      if (this.mediaRecorder?.stream) {
        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
      this.mediaRecorder = null;
      this.audioChunks = [];
    } else {
      if (this.isRecording) {
        try {
          await AudioRecord.stop();
        } catch (error) {
          console.warn('[AudioRecorder] Error during cleanup:', error);
        }
      }
    }

    this.isRecording = false;
    this.recordingUri = null;
    (this as any).recordingStartTime = null;
  }
}
