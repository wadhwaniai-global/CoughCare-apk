/**
 * The diagnosis gate: a record may only sync once its diagnostic
 * information is complete. This is the single definition of "complete" —
 * every save path (main form submit, ViewRecord inline test-results edit,
 * AddTestResults screen) must set status through gatedStatus().
 *
 * Rules (agreed with the data collection team, 2026-08-21):
 * - "No" (no test was done) is a valid, complete diagnosis — many
 *   participants are ordinary folks with no conditions.
 * - "Yes" requires a test type and an actual result. A result of
 *   "Pending" means the lab hasn't answered yet, so it does NOT pass.
 * - "Not yet" or an unanswered question keeps the record awaiting.
 */

export interface DiagnosisFields {
    test_done?: string | null;
    test_type?: string | null;
    test_result?: string | null;
}

export const hasDiagnosis = (r: DiagnosisFields): boolean => {
    if (r.test_done === 'No') return true;
    if (r.test_done === 'Yes') {
        return !!r.test_type && !!r.test_result && r.test_result !== 'Pending';
    }
    return false; // 'Not yet', unanswered, or anything unexpected
};

/** Status for a completed (non-draft) record: syncable or still awaiting. */
export const gatedStatus = (r: DiagnosisFields): 'pending' | 'awaiting_diagnosis' =>
    hasDiagnosis(r) ? 'pending' : 'awaiting_diagnosis';
