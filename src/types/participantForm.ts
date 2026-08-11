/**
 * Type definitions for the New Participant Form
 */

export type AlcoholUse = 'Yes' | 'Occasional' | 'No' | null;

export interface ParticipantFormData {
    participantId: string;
    mobileNumber: string;

    age: string;
    gender: string | null;
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

