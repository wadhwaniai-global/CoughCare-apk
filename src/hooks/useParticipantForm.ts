/**
 * Custom hook for managing participant form state
 */

import { useState, useEffect } from 'react';
import { ParticipantFormData } from '../types/participantForm';
import { getNextParticipantId } from '../services/DatabaseService';
import type { UserProfile } from '../services/AuthService';

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
        dateOfScreening: new Date().toLocaleDateString(),
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

    useEffect(() => {
        if (initialData?.participantId) return;
        const initId = async () => {
            const id = await getNextParticipantId(profile ?? null);
            setFormData(prev => ({ ...prev, participantId: id }));
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
    };
};

