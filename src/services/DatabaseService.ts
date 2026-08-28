import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import type { UserProfile } from './AuthService';
import { getRegionCode, getFacilityCode } from '../utils/participantIdCodes';

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<void> | null = null;

export interface Participant {
    id?: number;
    participant_id: string;
    mobile_number: string;
    full_name: string;
    age: number;
    gender: string;
    address?: string | null;
    date_of_screening: string;
    region: string;
    district: string;
    facility: string;
    community?: string | null;
    data_collector_name: string;
    created_by?: string | null; // Login username that created the record; local-only, never sent to the server
    consent_obtained: number; // 0 or 1
    diabetes_status: string;
    hiv_status: string;
    covid_status: string;
    tobacco_use: number; // 0 or 1
    tobacco_duration?: string | null;
    alcohol_use: number; // 0 or 1 (Occasional counts as 1)
    alcohol_use_frequency?: string | null; // 'Yes' | 'Occasional' | 'No'
    alcohol_duration?: string | null;
    previous_tb: number; // 0 or 1
    last_tb_year?: string | null;
    tb_treatment_completed?: string | null;
    recurring_tb?: number | null; // 0 or 1, null if unanswered
    symptoms: string; // JSON string
    test_done?: string | null; // Yes, No, Not yet
    test_type?: string | null;
    test_date_collection?: string | null;
    test_date_result?: string | null;
    test_result?: string | null;
    test_site?: string | null;
    test_notes?: string | null;
    created_at?: string;
    synced?: number;
    status?: string; // draft, awaiting_diagnosis, pending (ready to sync), synced
    purged?: number; // 1 = synced and stripped to dashboard-display fields only
    analysis_result?: string | null; // JSON string for ONNX result
    file_ids?: string | null; // JSON array of file IDs from server
    sync_attempts?: number; // Number of sync attempts
    last_sync_attempt?: string | null; // Timestamp of last sync attempt
    server_participant_id?: string | null; // Server-side ID after sync
}

export interface Recording {
    id?: number;
    participant_id: string;
    file_path: string;
    // cough_1, cough_2, cough_3, background; rejected takes get a unique
    // "<slot>_rej_<timestamp>_<n>" type to coexist with the UNIQUE constraint
    recording_type: string;
    duration: number;
    created_at?: string;
    synced?: number;
    confidence?: number | null; // this take's own cough score (null: unscored)
    rejected?: number; // 1 = discarded take, kept for research upload only
    file_id?: string | null; // server file id once uploaded
    checksum?: string | null; // server checksum once uploaded
}

export const initDatabase = async () => {
    // If already initialized, return
    if (db) {
        return;
    }

    // If initialization is in progress, wait for it
    if (initPromise) {
        return initPromise;
    }

    // Start initialization
    initPromise = (async () => {
        try {
            db = await SQLite.openDatabaseAsync('cough_against_tb_v2.db');
            await db.execAsync(`
      PRAGMA journal_mode = WAL;
      
      CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id TEXT UNIQUE NOT NULL,
        mobile_number TEXT NOT NULL,
        full_name TEXT NOT NULL,
        age INTEGER NOT NULL,
        gender TEXT NOT NULL,
        address TEXT,
        date_of_screening TEXT NOT NULL,
        region TEXT NOT NULL,
        district TEXT NOT NULL,
        facility TEXT NOT NULL,
        community TEXT,
        data_collector_name TEXT NOT NULL,
        consent_obtained INTEGER NOT NULL,
        diabetes_status TEXT NOT NULL,
        hiv_status TEXT NOT NULL,
        covid_status TEXT NOT NULL,
        tobacco_use INTEGER NOT NULL,
        tobacco_duration TEXT,
        alcohol_use INTEGER NOT NULL,
        alcohol_use_frequency TEXT,
        alcohol_duration TEXT,
        previous_tb INTEGER NOT NULL,
        last_tb_year TEXT,
        tb_treatment_completed TEXT,
        recurring_tb INTEGER,
        symptoms TEXT NOT NULL, -- JSON
        test_done TEXT,
        test_type TEXT,
        test_date_collection TEXT,
        test_date_result TEXT,
        test_result TEXT,
        test_site TEXT,
        test_notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0,
        status TEXT DEFAULT 'draft',
        analysis_result TEXT, -- JSON
        file_ids TEXT, -- JSON array of file IDs from server
        sync_attempts INTEGER DEFAULT 0,
        last_sync_attempt TEXT,
        server_participant_id TEXT, -- Server-side ID after sync
        created_by TEXT, -- Login username that created the record (local-only)
        purged INTEGER DEFAULT 0 -- synced + stripped to dashboard fields only
      );

      CREATE TABLE IF NOT EXISTS recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        recording_type TEXT NOT NULL,
        duration INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        synced INTEGER DEFAULT 0,
        confidence REAL,
        rejected INTEGER DEFAULT 0,
        file_id TEXT,
        checksum TEXT,
        FOREIGN KEY (participant_id) REFERENCES participants (participant_id),
        UNIQUE(participant_id, recording_type)
      );
    `);
            console.log('Database initialized successfully (v2)');

            // Migrate existing database to add new sync columns if they don't exist
            await migrateDatabase();

            // Catch-up purge of records synced before purge-after-sync
            // existed. Deliberately NOT awaited: it re-enters getDB(), which
            // waits on this very initPromise — awaiting here would deadlock,
            // and file deletion shouldn't block app startup anyway.
            purgeAllSyncedParticipants()
                .then((n) => { if (n > 0) console.log(`[DB Purge] Catch-up purged ${n} synced record(s)`); })
                .catch((err) => console.warn('[DB Purge] Catch-up purge failed:', err));
        } catch (error) {
            console.error('Error initializing database:', error);
            initPromise = null; // Reset on error so it can be retried
            throw error;
        }
    })();

    return initPromise;
};

/**
 * Migrate database to add new sync-related columns
 */
const migrateDatabase = async () => {
    if (!db) return;

    try {
        // Check if columns exist by querying table info
        const tableInfo = await db.getAllAsync(`PRAGMA table_info(participants)`);
        const columnNames = (tableInfo as any[]).map((col: any) => col.name);

        // Add new columns if they don't exist (using try-catch for each to handle if already exists)
        const migrations = [
            { name: 'file_ids', sql: `ALTER TABLE participants ADD COLUMN file_ids TEXT` },
            { name: 'sync_attempts', sql: `ALTER TABLE participants ADD COLUMN sync_attempts INTEGER DEFAULT 0` },
            { name: 'last_sync_attempt', sql: `ALTER TABLE participants ADD COLUMN last_sync_attempt TEXT` },
            { name: 'server_participant_id', sql: `ALTER TABLE participants ADD COLUMN server_participant_id TEXT` },
            { name: 'alcohol_use_frequency', sql: `ALTER TABLE participants ADD COLUMN alcohol_use_frequency TEXT` },
            { name: 'recurring_tb', sql: `ALTER TABLE participants ADD COLUMN recurring_tb INTEGER` },
            { name: 'created_by', sql: `ALTER TABLE participants ADD COLUMN created_by TEXT` },
            { name: 'purged', sql: `ALTER TABLE participants ADD COLUMN purged INTEGER DEFAULT 0` },
        ];

        for (const migration of migrations) {
            if (!columnNames.includes(migration.name)) {
                try {
                    await db.execAsync(migration.sql);
                    console.log(`[DB Migration] Added ${migration.name} column`);
                } catch (err: any) {
                    // Column might have been added by another process, ignore
                    if (!err.message?.includes('duplicate column')) {
                        console.warn(`[DB Migration] Error adding ${migration.name}:`, err);
                    }
                }
            }
        }

        // Recordings table: per-take score, rejected-take flag, and the
        // server file identity (fixes retried syncs dropping already-uploaded
        // files from the form payload).
        const recInfo = await db.getAllAsync(`PRAGMA table_info(recordings)`);
        const recColumns = (recInfo as any[]).map((col: any) => col.name);
        const recMigrations = [
            { name: 'confidence', sql: `ALTER TABLE recordings ADD COLUMN confidence REAL` },
            { name: 'rejected', sql: `ALTER TABLE recordings ADD COLUMN rejected INTEGER DEFAULT 0` },
            { name: 'file_id', sql: `ALTER TABLE recordings ADD COLUMN file_id TEXT` },
            { name: 'checksum', sql: `ALTER TABLE recordings ADD COLUMN checksum TEXT` },
        ];
        for (const migration of recMigrations) {
            if (!recColumns.includes(migration.name)) {
                try {
                    await db.execAsync(migration.sql);
                    console.log(`[DB Migration] Added recordings.${migration.name} column`);
                } catch (err: any) {
                    if (!err.message?.includes('duplicate column')) {
                        console.warn(`[DB Migration] Error adding recordings.${migration.name}:`, err);
                    }
                }
            }
        }

        // Sync-gate reclassification: 'pending' records saved before the
        // diagnosis gate existed may lack a complete diagnosis; move them to
        // 'awaiting_diagnosis' so they cannot sync. Mirrors hasDiagnosis()
        // in utils/diagnosisGate.ts; idempotent, safe to run every startup.
        try {
            const result = await db.runAsync(
                `UPDATE participants SET status = 'awaiting_diagnosis'
                 WHERE status = 'pending' AND NOT (
                     test_done = 'No'
                     OR (test_done = 'Yes'
                         AND test_type IS NOT NULL AND test_type != ''
                         AND test_result IS NOT NULL AND test_result != ''
                         AND test_result != 'Pending')
                 )`
            );
            if (result.changes > 0) {
                console.log(`[DB Migration] Moved ${result.changes} record(s) to awaiting_diagnosis`);
            }
        } catch (err) {
            console.warn('[DB Migration] Sync-gate reclassification failed:', err);
        }
    } catch (error) {
        console.error('[DB Migration] Error migrating database:', error);
        // Don't throw - migration errors are non-critical
    }
};

export const getDB = async () => {
    // Always wait for any in-flight initialization to finish: `db` is assigned
    // before table creation and migrations run, so checking `db` alone lets
    // queries race ahead of schema changes (e.g. a freshly added column).
    if (initPromise) {
        await initPromise;
    } else if (!db) {
        await initDatabase();
    }

    if (!db) {
        throw new Error('Database initialization failed');
    }

    return db;
};

// Helper function to normalize values (ensure null instead of undefined, empty strings for required fields)
const normalizeValue = (value: any, defaultValue: any = null): any => {
    if (value === undefined || value === '') {
        return defaultValue;
    }
    return value;
};

export const saveParticipant = async (participant: Participant) => {
    const database = await getDB();
    try {
        // Normalize all values to ensure proper storage (null for missing, not undefined)
        const normalizedParticipant = {
            participant_id: normalizeValue(participant.participant_id, ''),
            mobile_number: normalizeValue(participant.mobile_number, ''),
            full_name: normalizeValue(participant.full_name, ''),
            age: normalizeValue(participant.age, 0),
            gender: normalizeValue(participant.gender, ''),
            address: normalizeValue(participant.address, null),
            date_of_screening: normalizeValue(participant.date_of_screening, new Date().toISOString().split('T')[0]),
            region: normalizeValue(participant.region, ''),
            district: normalizeValue(participant.district, ''),
            facility: normalizeValue(participant.facility, ''),
            community: normalizeValue(participant.community, null),
            data_collector_name: normalizeValue(participant.data_collector_name, ''),
            consent_obtained: normalizeValue(participant.consent_obtained, 0),
            diabetes_status: normalizeValue(participant.diabetes_status, ''),
            hiv_status: normalizeValue(participant.hiv_status, ''),
            covid_status: normalizeValue(participant.covid_status, ''),
            tobacco_use: normalizeValue(participant.tobacco_use, 0),
            tobacco_duration: normalizeValue(participant.tobacco_duration, null),
            alcohol_use: normalizeValue(participant.alcohol_use, 0),
            alcohol_use_frequency: normalizeValue(participant.alcohol_use_frequency, null),
            alcohol_duration: normalizeValue(participant.alcohol_duration, null),
            previous_tb: normalizeValue(participant.previous_tb, 0),
            last_tb_year: normalizeValue(participant.last_tb_year, null),
            tb_treatment_completed: normalizeValue(participant.tb_treatment_completed, null),
            recurring_tb: normalizeValue(participant.recurring_tb, null),
            symptoms: normalizeValue(participant.symptoms, '{}'),
            test_done: normalizeValue(participant.test_done, null),
            test_type: normalizeValue(participant.test_type, null),
            test_date_collection: normalizeValue(participant.test_date_collection, null),
            test_date_result: normalizeValue(participant.test_date_result, null),
            test_result: normalizeValue(participant.test_result, null),
            test_site: normalizeValue(participant.test_site, null),
            test_notes: normalizeValue(participant.test_notes, null),
            status: normalizeValue(participant.status, 'draft'),
            analysis_result: normalizeValue(participant.analysis_result, null),
            created_by: normalizeValue(participant.created_by, null)
        };

        const result = await database.runAsync(
            `INSERT OR REPLACE INTO participants (
                participant_id, mobile_number, full_name, age, gender, address, date_of_screening,
                region, district, facility, community, data_collector_name, consent_obtained,
                diabetes_status, hiv_status, covid_status, tobacco_use, tobacco_duration,
                alcohol_use, alcohol_use_frequency, alcohol_duration, previous_tb, last_tb_year,
                tb_treatment_completed, recurring_tb,
                symptoms, test_done, test_type, test_date_collection, test_date_result,
                test_result, test_site, test_notes, status, analysis_result, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                normalizedParticipant.participant_id,
                normalizedParticipant.mobile_number,
                normalizedParticipant.full_name,
                normalizedParticipant.age,
                normalizedParticipant.gender,
                normalizedParticipant.address,
                normalizedParticipant.date_of_screening,
                normalizedParticipant.region,
                normalizedParticipant.district,
                normalizedParticipant.facility,
                normalizedParticipant.community,
                normalizedParticipant.data_collector_name,
                normalizedParticipant.consent_obtained,
                normalizedParticipant.diabetes_status,
                normalizedParticipant.hiv_status,
                normalizedParticipant.covid_status,
                normalizedParticipant.tobacco_use,
                normalizedParticipant.tobacco_duration,
                normalizedParticipant.alcohol_use,
                normalizedParticipant.alcohol_use_frequency,
                normalizedParticipant.alcohol_duration,
                normalizedParticipant.previous_tb,
                normalizedParticipant.last_tb_year,
                normalizedParticipant.tb_treatment_completed,
                normalizedParticipant.recurring_tb,
                normalizedParticipant.symptoms,
                normalizedParticipant.test_done,
                normalizedParticipant.test_type,
                normalizedParticipant.test_date_collection,
                normalizedParticipant.test_date_result,
                normalizedParticipant.test_result,
                normalizedParticipant.test_site,
                normalizedParticipant.test_notes,
                normalizedParticipant.status,
                normalizedParticipant.analysis_result,
                normalizedParticipant.created_by
            ]
        );
        return result.lastInsertRowId;
    } catch (error) {
        console.error("Error saving participant:", error);
        throw error;
    }
};

export const saveRecording = async (recording: Recording) => {
    const database = await getDB();
    try {
        // Use INSERT OR REPLACE to prevent duplicates based on (participant_id, recording_type)
        await database.runAsync(
            `INSERT OR REPLACE INTO recordings (participant_id, file_path, recording_type, duration, confidence, rejected)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                recording.participant_id,
                recording.file_path,
                recording.recording_type,
                recording.duration,
                recording.confidence ?? null,
                recording.rejected ?? 0,
            ]
        );
    } catch (error) {
        console.error("Error saving recording:", error);
        throw error;
    }
};

export const getParticipants = async (createdBy: string): Promise<Participant[]> => {
    const database = await getDB();
    try {
        const rows = await database.getAllAsync<Participant>(
            `SELECT * FROM participants WHERE created_by = ? ORDER BY created_at DESC`,
            [createdBy]
        );
        return rows;
    } catch (error) {
        console.error("Error fetching participants:", error);
        return [];
    }
};

export const getParticipantById = async (participantId: string): Promise<Participant | null> => {
    const database = await getDB();
    try {
        const row = await database.getFirstAsync<Participant>(
            `SELECT * FROM participants WHERE participant_id = ?`,
            [participantId]
        );
        return row || null;
    } catch (error) {
        console.error("Error fetching participant:", error);
        return null;
    }
};

export const getRecordingsByParticipantId = async (
    participantId: string,
    includeRejected: boolean = false // only sync wants the discarded takes
): Promise<Recording[]> => {
    const database = await getDB();
    try {
        // Get the latest recording for each type (to handle any existing duplicates)
        const rows = await database.getAllAsync<Recording>(
            `SELECT * FROM recordings
             WHERE participant_id = ?
             ${includeRejected ? '' : 'AND COALESCE(rejected, 0) = 0'}
             AND id IN (
                 SELECT MAX(id)
                 FROM recordings
                 WHERE participant_id = ?
                 GROUP BY recording_type
             )
             ORDER BY
                 CASE recording_type 
                     WHEN 'cough_1' THEN 1
                     WHEN 'cough_2' THEN 2
                     WHEN 'cough_3' THEN 3
                     WHEN 'background' THEN 4
                     ELSE 5
                 END`,
            [participantId, participantId]
        );
        return rows;
    } catch (error) {
        console.error("Error fetching recordings:", error);
        return [];
    }
};

// Clean up duplicate recordings (keep only the latest for each participant_id + recording_type)
export const cleanupDuplicateRecordings = async () => {
    const database = await getDB();
    try {
        await database.runAsync(`
            DELETE FROM recordings 
            WHERE id NOT IN (
                SELECT MAX(id) 
                FROM recordings 
                GROUP BY participant_id, recording_type
            )
        `);
        console.log('Cleaned up duplicate recordings');
    } catch (error) {
        console.error("Error cleaning up duplicates:", error);
    }
};

export const getNextParticipantId = async (profile: UserProfile | null): Promise<string> => {
    const database = await getDB();
    try {
        const regionCode = getRegionCode(profile?.region);
        const facilityCode = getFacilityCode(profile?.facility);

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}${mm}${dd}`;

        // Pattern: GHA-{regionCode}{facilityCode}{dateStr}{4-digit seq}
        const prefix = `GHA-${regionCode}${facilityCode}${dateStr}`;
        const rows = await database.getAllAsync<{ participant_id: string }>(
            `SELECT participant_id FROM participants WHERE participant_id LIKE ?`,
            [`${prefix}%`]
        );

        let maxSeq = 0;
        const seqRegex = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d{4})$`);
        for (const row of rows) {
            const m = row.participant_id.match(seqRegex);
            if (m) {
                const n = parseInt(m[1], 10);
                if (!isNaN(n) && n > maxSeq) maxSeq = n;
            }
        }
        const nextSeq = String(maxSeq + 1).padStart(4, '0');
        return `${prefix}${nextSeq}`;
    } catch (error) {
        console.error("Error generating next participant ID:", error);
        // Fallback: timestamp-based unique ID to avoid collision
        return `GHA-00000000000000${Date.now()}`.slice(0, 23);
    }
};



// Helper to format value for display (show "N/A" for null/undefined)
const formatForDisplay = (value: any): string => {
    if (value === null || value === undefined || value === '') {
        return 'N/A';
    }
    return String(value);
};

// Debug function to view all database contents
export const viewDatabaseContents = async () => {
    const database = await getDB();
    try {
        console.log('\n========== DATABASE CONTENTS ==========');

        // Get all participants
        const participants = await database.getAllAsync<Participant>(
            `SELECT * FROM participants ORDER BY created_at DESC`
        );
        console.log(`\n📋 PARTICIPANTS (${participants.length} total):`);
        participants.forEach((p, index) => {
            console.log(`\n${index + 1}. Participant ID: ${formatForDisplay(p.participant_id)}`);
            console.log(`   Name: ${formatForDisplay(p.full_name)}`);
            console.log(`   Mobile: ${formatForDisplay(p.mobile_number)}`);
            console.log(`   Age: ${formatForDisplay(p.age)}, Gender: ${formatForDisplay(p.gender)}`);
            console.log(`   Address: ${formatForDisplay(p.address)}`);
            console.log(`   Date of Screening: ${formatForDisplay(p.date_of_screening)}`);
            console.log(`   Region: ${formatForDisplay(p.region)}, District: ${formatForDisplay(p.district)}`);
            console.log(`   Facility: ${formatForDisplay(p.facility)}, Community: ${formatForDisplay(p.community)}`);
            console.log(`   Data Collector: ${formatForDisplay(p.data_collector_name)}`);
            console.log(`   Consent: ${p.consent_obtained ? 'Yes' : 'No'}`);
            console.log(`   Diabetes: ${formatForDisplay(p.diabetes_status)}`);
            console.log(`   HIV: ${formatForDisplay(p.hiv_status)}`);
            console.log(`   COVID: ${formatForDisplay(p.covid_status)}`);
            console.log(`   Tobacco Use: ${p.tobacco_use ? 'Yes' : 'No'}, Duration: ${formatForDisplay(p.tobacco_duration)}`);
            console.log(`   Alcohol Use: ${p.alcohol_use_frequency || (p.alcohol_use ? 'Yes' : 'No')}, Duration: ${formatForDisplay(p.alcohol_duration)}`);
            console.log(`   Previous TB: ${p.previous_tb ? 'Yes' : 'No'}, Year: ${formatForDisplay(p.last_tb_year)}, Completed: ${formatForDisplay(p.tb_treatment_completed)}, Recurring: ${p.recurring_tb == null ? 'N/A' : p.recurring_tb === 1 ? 'Yes' : 'No'}`);
            console.log(`   Symptoms: ${formatForDisplay(p.symptoms)}`);
            console.log(`   Test Done: ${formatForDisplay(p.test_done)}, Type: ${formatForDisplay(p.test_type)}`);
            console.log(`   Test Result: ${formatForDisplay(p.test_result)}, Site: ${formatForDisplay(p.test_site)}`);
            console.log(`   Test Notes: ${formatForDisplay(p.test_notes)}`);
            console.log(`   Status: ${formatForDisplay(p.status)}`);
            console.log(`   Created: ${formatForDisplay(p.created_at)}`);
            console.log(`   Synced: ${p.synced ? 'Yes' : 'No'}`);
            if (p.analysis_result) {
                try {
                    const analysis = JSON.parse(p.analysis_result);
                    console.log(`   Analysis: Cough Detected: ${analysis.coughDetected}, Confidence: ${analysis.confidence ? (analysis.confidence * 100).toFixed(1) + '%' : 'N/A'}`);
                } catch (e) {
                    console.log(`   Analysis: ${formatForDisplay(p.analysis_result)}`);
                }
            }
        });

        // Get all recordings
        const recordings = await database.getAllAsync<Recording>(
            `SELECT * FROM recordings ORDER BY created_at DESC`
        );
        console.log(`\n🎤 RECORDINGS (${recordings.length} total):`);
        recordings.forEach((r, index) => {
            console.log(`\n${index + 1}. Recording ID: ${formatForDisplay(r.id)}`);
            console.log(`   Participant ID: ${formatForDisplay(r.participant_id)}`);
            console.log(`   Type: ${formatForDisplay(r.recording_type)}`);
            console.log(`   Duration: ${formatForDisplay(r.duration)} seconds`);
            console.log(`   File Path: ${formatForDisplay(r.file_path)}`);
            console.log(`   Created: ${formatForDisplay(r.created_at)}`);
            console.log(`   Synced: ${r.synced ? 'Yes' : 'No'}`);
        });

        // Get stats (all users — this is a debug dump of the whole device DB)
        const pendingCount = await database.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM participants WHERE status = 'pending'`);
        const draftCount = await database.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM participants WHERE status = 'draft'`);
        const totalCount = await database.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM participants`);
        const stats = { pending: pendingCount?.count || 0, drafts: draftCount?.count || 0, total: totalCount?.count || 0 };
        console.log(`\n📊 STATISTICS:`);
        console.log(`   Pending: ${stats.pending}`);
        console.log(`   Drafts: ${stats.drafts}`);
        console.log(`   Total: ${stats.total}`);

        console.log('\n========================================\n');

        return {
            participants,
            recordings,
            stats
        };
    } catch (error) {
        console.error("Error viewing database contents:", error);
        throw error;
    }
};

export const getStats = async (createdBy: string) => {
    const database = await getDB();
    try {
        const pending = await database.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM participants WHERE status = 'pending' AND created_by = ?`, [createdBy]);
        const awaiting = await database.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM participants WHERE status = 'awaiting_diagnosis' AND created_by = ?`, [createdBy]);
        const drafts = await database.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM participants WHERE status = 'draft' AND created_by = ?`, [createdBy]);
        const synced = await database.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM participants WHERE status = 'synced' AND created_by = ?`, [createdBy]);
        const total = await database.getFirstAsync<{ count: number }>(`SELECT COUNT(*) as count FROM participants WHERE created_by = ?`, [createdBy]);

        return {
            pending: pending?.count || 0,
            awaiting: awaiting?.count || 0,
            drafts: drafts?.count || 0,
            synced: synced?.count || 0,
            total: total?.count || 0
        };
    } catch (error) {
        console.error("Error fetching stats:", error);
        return { pending: 0, awaiting: 0, drafts: 0, synced: 0, total: 0 };
    }
};

export const getPendingParticipants = async (createdBy: string): Promise<Participant[]> => {
    const database = await getDB();
    try {
        const rows = await database.getAllAsync<Participant>(
            `SELECT * FROM participants WHERE status = 'pending' AND created_by = ? ORDER BY created_at DESC`,
            [createdBy]
        );
        return rows;
    } catch (error) {
        console.error("Error fetching pending participants:", error);
        return [];
    }
};

export const getAwaitingDiagnosisParticipants = async (createdBy: string): Promise<Participant[]> => {
    const database = await getDB();
    try {
        const rows = await database.getAllAsync<Participant>(
            `SELECT * FROM participants WHERE status = 'awaiting_diagnosis' AND created_by = ? ORDER BY created_at DESC`,
            [createdBy]
        );
        return rows;
    } catch (error) {
        console.error("Error fetching awaiting-diagnosis participants:", error);
        return [];
    }
};

/**
 * Data minimization after a confirmed sync: the server now owns the record,
 * so the device keeps only what the Recent Cases dashboard displays
 * (participant_id/full_name, mobile, region, created_at, status, owner,
 * analysis_result for the confidence line) and deletes everything else —
 * all form answers and every audio file, rejected takes included.
 *
 * Deliberately retained on-device (2026-08-28): mobile_number and address
 * (which carries the packed [GPS:lat,lng] tag). These are never uploaded —
 * the device is their only home, kept for participant follow-up.
 */
export const purgeSyncedParticipantData = async (participantId: string): Promise<void> => {
    const database = await getDB();
    try {
        const recordings = await database.getAllAsync<Recording>(
            `SELECT * FROM recordings WHERE participant_id = ?`,
            [participantId]
        );
        for (const rec of recordings) {
            try {
                await FileSystem.deleteAsync(rec.file_path, { idempotent: true });
            } catch (err) {
                console.warn(`[DB Purge] Could not delete audio file ${rec.file_path}:`, err);
            }
        }
        await database.runAsync(`DELETE FROM recordings WHERE participant_id = ?`, [participantId]);

        // NOT NULL columns get '' / 0, nullable ones NULL
        await database.runAsync(
            `UPDATE participants SET
                age = 0, gender = '', date_of_screening = '',
                district = '', facility = '', community = NULL,
                data_collector_name = '', consent_obtained = 0,
                diabetes_status = '', hiv_status = '', covid_status = '',
                tobacco_use = 0, tobacco_duration = NULL,
                alcohol_use = 0, alcohol_use_frequency = NULL, alcohol_duration = NULL,
                previous_tb = 0, last_tb_year = NULL, tb_treatment_completed = NULL,
                recurring_tb = NULL, symptoms = '{}',
                test_done = NULL, test_type = NULL, test_date_collection = NULL,
                test_date_result = NULL, test_result = NULL, test_site = NULL,
                test_notes = NULL, file_ids = NULL,
                purged = 1
             WHERE participant_id = ?`,
            [participantId]
        );
        console.log(`[DB Purge] Purged synced participant ${participantId}`);
    } catch (error) {
        // Non-fatal: the sync itself succeeded; purge can retry at next launch
        console.error(`[DB Purge] Error purging ${participantId}:`, error);
    }
};

/** Catch-up purge for records synced before purging existed (idempotent). */
export const purgeAllSyncedParticipants = async (): Promise<number> => {
    const database = await getDB();
    try {
        const rows = await database.getAllAsync<{ participant_id: string }>(
            `SELECT participant_id FROM participants WHERE status = 'synced' AND COALESCE(purged, 0) = 0`
        );
        for (const row of rows) {
            await purgeSyncedParticipantData(row.participant_id);
        }
        return rows.length;
    } catch (error) {
        console.error('[DB Purge] Catch-up purge failed:', error);
        return 0;
    }
};

export const getDraftParticipants = async (createdBy: string): Promise<Participant[]> => {
    const database = await getDB();
    try {
        const rows = await database.getAllAsync<Participant>(
            `SELECT * FROM participants WHERE status = 'draft' AND created_by = ? ORDER BY created_at DESC`,
            [createdBy]
        );
        return rows;
    } catch (error) {
        console.error("Error fetching draft participants:", error);
        return [];
    }
};
