/**
 * Custom hook for managing participant form state
 */

import { useState, useEffect } from 'react';
import { ParticipantFormData } from '../types/participantForm';
import { getNextParticipantId } from '../services/DatabaseService';
import type { UserProfile } from '../services/AuthService';
import { todayDDMMYYYY } from '../utils/dateUtils';

export const useParticipantForm = (
    initialData?: Partial<ParticipantFormData>,
    profile?: UserProfile | null,
) => {
    const [formData, setFormData] = useState<ParticipantFormData>({
        participantId: '',
        mobileNumber: '',

        age: '',
        gender: null,
        address: '',
        dateOfScreening: todayDDMMYYYY(),
        community: '',
        gpsLatitude: null,
        gpsLongitude: null,
        consentObtained: null,
        diabetesStatus: null,
        hivStatus: null,
        covidStatus: null,
        tobaccoUse: null,
        tobaccoDuration: null,
        alcoholUse: null,
        alcoholDuration: null,
        previousTb: null,
        tbYear: '',
        tbTreatmentStatus: null,
        recurringTb: null,
        symptoms: {},
        recording1: null,
        recording2: null,
        recording3: null,
        recordingBackground: null,
        // Section E
        testResult: null,
        testDateCollection: '',
        testDateResult: '',
        testType: null,
        testSite: '',
        testNotes: '',
        ...initialData,
    });

    // Set when no participant ID could be minted (e.g. the profile has no
    // collector code); the screen must block creation and show this message.
    const [participantIdError, setParticipantIdError] = useState<string | null>(null);

    useEffect(() => {
        if (initialData?.participantId) return;
        const initId = async () => {
            try {
                const id = await getNextParticipantId(profile ?? null);
                setFormData(prev => ({ ...prev, participantId: id }));
                setParticipantIdError(null);
            } catch (error: any) {
                setParticipantIdError(error?.message || 'Could not create a participant ID.');
            }
        };
        initId();
    }, [profile]);

    const updateFormData = (updates: Partial<ParticipantFormData>) => {
        setFormData(prev => ({ ...prev, ...updates }));
    };

    const updateField = <K extends keyof ParticipantFormData>(
        field: K,
        value: ParticipantFormData[K]
    ) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const updateSymptom = (key: string, updates: { present?: boolean | null; duration?: string }) => {
        setFormData(prev => ({
            ...prev,
            symptoms: {
                ...prev.symptoms,
                [key]: {
                    ...prev.symptoms[key],
                    ...updates
                }
            }
        }));
    };

    return {
        formData,
        setFormData,
        updateFormData,
        updateField,
        updateSymptom,
        participantIdError,
    };
};

