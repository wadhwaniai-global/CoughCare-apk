/**
 * Custom hook for managing participant form state
 */

import { useState, useEffect } from 'react';
import { ParticipantFormData } from '../types/participantForm';
import { getNextParticipantId } from '../services/DatabaseService';

export const useParticipantForm = () => {
    const [formData, setFormData] = useState<ParticipantFormData>({
        participantId: '',
        dataCollectorName: '',
        mobileNumber: '',

        age: '',
        gender: null,
        address: '',
        dateOfScreening: new Date().toLocaleDateString(),
        region: null,
        district: '',
        facility: '',
        community: '',
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
    });

    useEffect(() => {
        const initId = async () => {
            const id = await getNextParticipantId();
            setFormData(prev => ({ ...prev, participantId: id }));
        };
        initId();
    }, []);

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

