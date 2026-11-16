/**
 * Type definitions for the New Participant Form
 */

export type AlcoholUse = 'Yes' | 'Occasional' | 'No' | null;

/** Where the screening took place: at a health facility, or out in the
 *  community. Asked on every record; these strings are what is stored on the
 *  phone and sent to the server as `collection_site`. */
export const COLLECTION_SITES = ['Health Facility', 'Community'] as const;
export type CollectionSite = typeof COLLECTION_SITES[number];

export interface ParticipantFormData {
    participantId: string;
    mobileNumber: string;

    age: string;
    gender: string | null;
    collectionSite: CollectionSite | null;
    address: string;
    dateOfScreening: string;
    community: string;
    gpsLatitude: string | null;
    gpsLongitude: string | null;
    consentObtained: boolean | null;
    diabetesStatus: string | null;
    hivStatus: string | null;
    covidStatus: string | null;
    tobaccoUse: boolean | null;
    tobaccoDuration: string | null;
    alcoholUse: AlcoholUse;
    alcoholDuration: string | null;
    previousTb: boolean | null;
    tbYear: string;
    tbTreatmentStatus: string | null;
    recurringTb: boolean | null;
    symptoms: Record<string, { present: boolean | null; duration: string }>;
    recording1: string | null;
    recording2: string | null;
    recording3: string | null;
    recordingBackground: string | null;
    /** Was the participant wearing a mask while the cough samples were
     *  recorded? Mandatory; affects the acoustic signal. null = unanswered. */
    patientWearingMask: boolean | null;
    // Section E: Diagnostic Testing
    testResult: string | null;
    testDateCollection: string;
    testDateResult: string;
    testType: string | null;
    testSite: string;
    testNotes: string;
}

export interface AnalysisResult {
    loading: boolean;
    result?: {
        coughDetected: boolean;
        confidence?: number;
        [key: string]: any;
    };
    error?: string;
}

export interface AnalysisResults {
    [key: string]: AnalysisResult;
}

