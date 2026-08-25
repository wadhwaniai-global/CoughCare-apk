/**
 * Sync Service
 * Handles transactional sync of participants and recordings to the server
 * Process: Upload files first → Get file IDs → Upload form metadata with file IDs
 */

import { apiService } from './ApiService';
import { authService } from './AuthService';
import { getBuildInfo } from '../utils/buildInfo';
import {
  getPendingParticipants,
  getRecordingsByParticipantId,
  purgeSyncedParticipantData,
  getDB,
  Participant,
  Recording,
} from './DatabaseService';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';

export interface SyncProgress {
  total: number;
  completed: number;
  current?: string;
  error?: string;
}

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

class SyncService {
  private isSyncing = false;
  private syncProgressCallback?: (progress: SyncProgress) => void;

  /**
   * Set callback for sync progress updates
   */
  setProgressCallback(callback: (progress: SyncProgress) => void) {
    this.syncProgressCallback = callback;
  }

  /**
   * Check if device is online
   */
  async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return state.isConnected ?? false;
  }

  /**
   * Upload a single file and return file info (file_id and checksum)
   */
  private async uploadFile(filePath: string): Promise<{ file_id: string; checksum: string }> {
    try {
      // Check if file exists
      const fileInfo = await FileSystem.getInfoAsync(filePath);
      if (!fileInfo.exists) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Upload file
      const result = await apiService.uploadFile(filePath);
      
      if (!result.file_id) {
        throw new Error('No file_id returned from server');
      }

      if (!result.checksum) {
        throw new Error('No checksum returned from server');
      }

      return {
        file_id: result.file_id,
        checksum: result.checksum,
      };
    } catch (error: any) {
      console.error(`[SyncService] Error uploading file ${filePath}:`, error);
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Upload form metadata with file IDs
   * fileIds should be an array of { file_id, checksum } objects
   */
  private async uploadFormMetadata(
    participant: Participant,
    fileIds: Array<{ file_id: string; checksum: string }>,
    recordingsMeta: Array<{
      file_id: string;
      type: string;
      rejected: boolean;
      confidence: number | null;
      duration: number | null;
    }>
  ): Promise<{
    form_id: string;
    user_id: string;
    form_data: any;
    file_references: string[];
    created_at: string;
  }> {
    try {
      // Parse existing data
      const symptoms = participant.symptoms ? JSON.parse(participant.symptoms) : {};
      const analysisResult = participant.analysis_result
        ? JSON.parse(participant.analysis_result)
        : null;

      // Parse GPS tag out of packed address field
      const rawAddress = participant.address || '';
      const gpsMatch = rawAddress.match(/\[GPS:([-\d.]+),([-\d.]+)\]/);
      const cleanAddress = rawAddress.replace(/\n?\[GPS:[-\d.]+,[-\d.]+\]/, '').trim() || null;
      const gps_latitude = gpsMatch ? parseFloat(gpsMatch[1]) : null;
      const gps_longitude = gpsMatch ? parseFloat(gpsMatch[2]) : null;

      // Prepare form_data object with all participant fields
      const formDataObject = {
        participant_id: participant.participant_id,
        mobile_number: participant.mobile_number,
        full_name: participant.full_name,
        age: participant.age,
        gender: participant.gender,
        address: cleanAddress,
        gps_latitude,
        gps_longitude,
        date_of_screening: participant.date_of_screening,
        region: participant.region,
        district: participant.district,
        facility: participant.facility,
        community: participant.community,
        data_collector_name: participant.data_collector_name,
        consent_obtained: participant.consent_obtained === 1,
        diabetes_status: participant.diabetes_status,
        hiv_status: participant.hiv_status,
        covid_status: participant.covid_status,
        tobacco_use: participant.tobacco_use === 1,
        tobacco_duration: participant.tobacco_duration,
        alcohol_use: participant.alcohol_use === 1,
        alcohol_use_frequency: participant.alcohol_use_frequency ?? null,
        alcohol_duration: participant.alcohol_duration,
        previous_tb: participant.previous_tb === 1,
        last_tb_year: participant.last_tb_year,
        tb_treatment_completed: participant.tb_treatment_completed,
        recurring_tb: participant.recurring_tb == null ? null : participant.recurring_tb === 1,
        symptoms: symptoms,
        test_done: participant.test_done,
        test_type: participant.test_type,
        test_date_collection: participant.test_date_collection,
        test_date_result: participant.test_date_result,
        test_result: participant.test_result,
        test_site: participant.test_site,
        test_notes: participant.test_notes,
        analysis_result: analysisResult,
        // Per-recording detail: every uploaded file's own cough score, slot,
        // and whether the collector discarded it (re-record). file_id joins
        // against the top-level file_ids/file_references.
        recordings: recordingsMeta,
        // Which build produced this form. Both the test and field apps talk to
        // the same server; app_channel separates their data: "test" = the
        // CoughCare Test app, "production" = the field app ("preview" in
        // pre-cutover builds), "development" = a dev build. Forms without
        // these keys predate the tagging (all field). The seq/update id also
        // pin the exact code version for debugging.
        app_channel: getBuildInfo().channel,
        app_bundle_seq: getBuildInfo().bundleSeq,
        app_update_id: getBuildInfo().bundleId,
      };

      // Prepare request body according to API contract
      // API expects: { form_data: {...}, file_ids: [{ file_id, checksum }] }
      const requestBody = {
        form_data: formDataObject,
        file_ids: fileIds, // Array of { file_id, checksum } objects
      };

      const result = await apiService.submitForm(requestBody);
      return result;
    } catch (error: any) {
      console.error('[SyncService] Error uploading form metadata:', error);
      throw error;
    }
  }

  /**
   * Sync a single participant transactionally
   */
  private async syncParticipant(participant: Participant): Promise<void> {
    const database = await getDB();
    const participantId = participant.participant_id;

    try {
      // Update last sync attempt
      await database.runAsync(
        `UPDATE participants SET last_sync_attempt = ? WHERE participant_id = ?`,
        [new Date().toISOString(), participantId]
      );

      // Get all recordings for this participant, including rejected takes —
      // those are uploaded too (with their scores) for model research.
      const recordings = await getRecordingsByParticipantId(participantId, true);

      // Step 1: Upload all files and collect file info (file_id and checksum).
      // The server identity is stored on each recording row so a retried sync
      // re-sends the COMPLETE file_ids list — previously, files uploaded on a
      // failed earlier attempt were skipped and silently dropped from the form.
      const fileEntries: Array<{ file_id: string; checksum: string; recording: Recording }> = [];

      for (const recording of recordings) {
        try {
          let fileId = recording.file_id || null;
          let checksum = recording.checksum || null;

          if (!(recording.synced === 1 && fileId && checksum)) {
            const fileInfo = await this.uploadFile(recording.file_path);
            fileId = fileInfo.file_id;
            checksum = fileInfo.checksum;

            // Mark recording as synced and remember its server identity
            await database.runAsync(
              `UPDATE recordings SET synced = 1, file_id = ?, checksum = ? WHERE id = ?`,
              [fileId, checksum, recording.id]
            );
          }

          fileEntries.push({ file_id: fileId!, checksum: checksum!, recording });
        } catch (error: any) {
          console.error(
            `[SyncService] Failed to upload recording ${recording.recording_type}:`,
            error
          );
          throw error; // Fail the entire sync if any file fails
        }
      }

      // Every uploaded file goes in the top-level list — it is the only place
      // the backend validates existence/checksums (their explicit guidance).
      const fileIds = fileEntries.map(({ file_id, checksum }) => ({ file_id, checksum }));

      // Per-file metadata rides inside form_data; file_id is the join key.
      const recordingsMeta = fileEntries.map(({ file_id, recording }) => ({
        file_id,
        // strip the uniqueness suffix off rejected takes: "cough_1_rej_..." -> "cough_1"
        type: recording.recording_type.replace(/_rej_.*$/, ''),
        rejected: recording.rejected === 1,
        confidence: recording.confidence ?? null,
        duration: recording.duration ?? null,
      }));

      // Step 2: Upload form metadata with file IDs
      const serverResponse = await this.uploadFormMetadata(participant, fileIds, recordingsMeta);

      // Step 3: Mark participant as synced
      // Build update query dynamically to handle columns that might not exist yet
      const serverId = serverResponse?.form_id || serverResponse?.id || null;
      const fileIdsJson = JSON.stringify(fileIds);
      
      await database.runAsync(
        `UPDATE participants 
         SET synced = 1, 
             status = 'synced',
             sync_attempts = COALESCE(sync_attempts, 0) + 1
         WHERE participant_id = ?`,
        [participantId]
      );
      
      // Update optional columns if they exist (using separate queries to avoid errors)
      try {
        await database.runAsync(
          `UPDATE participants SET file_ids = ? WHERE participant_id = ?`,
          [fileIdsJson, participantId]
        );
      } catch (err) {
        // Column might not exist, ignore
        console.warn('[SyncService] Could not update file_ids:', err);
      }
      
      if (serverId) {
        try {
          await database.runAsync(
            `UPDATE participants SET server_participant_id = ? WHERE participant_id = ?`,
            [serverId, participantId]
          );
        } catch (err) {
          // Column might not exist, ignore
          console.warn('[SyncService] Could not update server_participant_id:', err);
        }
      }

      // Step 4: The server owns the record now — strip the device copy down
      // to the dashboard-display fields and delete every audio file.
      await purgeSyncedParticipantData(participantId);

      console.log(`[SyncService] Successfully synced participant ${participantId}`);
    } catch (error: any) {
      // Increment sync attempts and keep as pending
      try {
        await database.runAsync(
          `UPDATE participants 
           SET sync_attempts = COALESCE(sync_attempts, 0) + 1
           WHERE participant_id = ?`,
          [participantId]
        );
        
        // Update last_sync_attempt if column exists
        try {
          await database.runAsync(
            `UPDATE participants SET last_sync_attempt = ? WHERE participant_id = ?`,
            [new Date().toISOString(), participantId]
          );
        } catch (err) {
          // Column might not exist, ignore
        }
      } catch (err) {
        console.error('[SyncService] Error updating sync attempts:', err);
      }

      console.error(`[SyncService] Failed to sync participant ${participantId}:`, error);
      throw error;
    }
  }

  /**
   * Sync all pending participants
   */
  async syncPendingForms(): Promise<SyncResult> {
    if (this.isSyncing) {
      console.warn('[SyncService] Sync already in progress');
      return { success: false, synced: 0, failed: 0, errors: ['Sync already in progress'] };
    }

    // Check if online
    const online = await this.isOnline();
    if (!online) {
      return {
        success: false,
        synced: 0,
        failed: 0,
        errors: ['Device is offline'],
      };
    }

    // Only sync records created by the currently logged-in user
    const username = await authService.getUsername();
    if (!username) {
      console.warn('[SyncService] No logged-in user, skipping sync');
      return { success: false, synced: 0, failed: 0, errors: ['Not logged in'] };
    }

    this.isSyncing = true;

    try {
      // Get the current user's pending participants
      const pendingParticipants = await getPendingParticipants(username);
      const total = pendingParticipants.length;

      if (total === 0) {
        this.isSyncing = false;
        return { success: true, synced: 0, failed: 0, errors: [] };
      }

      const errors: string[] = [];
      let synced = 0;
      let failed = 0;

      // Update progress
      this.updateProgress({ total, completed: 0 });

      // Sync each participant one at a time (transactional)
      for (let i = 0; i < pendingParticipants.length; i++) {
        const participant = pendingParticipants[i];

        try {
          this.updateProgress({
            total,
            completed: i,
            current: `Syncing ${participant.full_name || participant.participant_id}...`,
          });

          await this.syncParticipant(participant);
          synced++;
        } catch (error: any) {
          failed++;
          const errorMsg = `Failed to sync ${participant.participant_id}: ${error.message}`;
          errors.push(errorMsg);
          console.error(`[SyncService] ${errorMsg}`);
        }

        this.updateProgress({
          total,
          completed: i + 1,
        });
      }

      this.isSyncing = false;
      return {
        success: failed === 0,
        synced,
        failed,
        errors,
      };
    } catch (error: any) {
      this.isSyncing = false;
      return {
        success: false,
        synced: 0,
        failed: 0,
        errors: [error.message || 'Sync failed'],
      };
    }
  }

  /**
   * Update sync progress
   */
  private updateProgress(progress: SyncProgress) {
    if (this.syncProgressCallback) {
      this.syncProgressCallback(progress);
    }
  }

  /**
   * Check if sync is in progress
   */
  getIsSyncing(): boolean {
    return this.isSyncing;
  }
}

export const syncService = new SyncService();

