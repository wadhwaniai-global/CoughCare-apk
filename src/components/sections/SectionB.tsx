/**
 * Section B: Comorbidities & Vulnerability
 */

import React from 'react';
import { View, Text, TextInput, StyleSheet, ToastAndroid, Platform, Alert } from 'react-native';
import { Dropdown } from '../forms/Dropdown';
import { RadioButtonGroup } from '../forms/RadioButtonGroup';
import { ParticipantFormData } from '../../types/participantForm';

interface SectionBProps {
    formData: ParticipantFormData;
    updateField: <K extends keyof ParticipantFormData>(field: K, value: ParticipantFormData[K]) => void;
    expandedDropdown: string | null;
    setExpandedDropdown: (key: string | null) => void;
    errors?: Record<string, string>;
}

export const SectionB: React.FC<SectionBProps> = ({
    formData,
    updateField,
    expandedDropdown,
    setExpandedDropdown,
    errors = {},
}) => {
    const handleYearBlur = () => {
        if (!formData.tbYear || formData.tbYear.trim() === '') return;

        const currentYear = new Date().getFullYear();
        const year = parseInt(formData.tbYear, 10);

        if (isNaN(year) || year < 1980 || year > currentYear) {
            const message = `Year must be between 1980 and ${currentYear}`;

            if (Platform.OS === 'android') {
                ToastAndroid.show(message, ToastAndroid.SHORT);
            } else {
                Alert.alert('Invalid Year', message);
            }

            updateField('tbYear', '');
        }
    };

    return (
        <>
            <Dropdown
                label="Diabetes Status"
                value={formData.diabetesStatus}
                options={['Diabetic', 'Non-Diabetic', 'Unknown']}
                onSelect={(val) => updateField('diabetesStatus', val)}
                isExpanded={expandedDropdown === 'diabetes'}
                onToggle={() => setExpandedDropdown(expandedDropdown === 'diabetes' ? null : 'diabetes')}
            />
            {errors['diabetesStatus'] && <Text style={styles.errorText}>{errors['diabetesStatus']}</Text>}

            <Dropdown
                label="HIV Status"
                value={formData.hivStatus}
                options={['Positive', 'Negative', 'Unknown', 'Prefer not to say']}
                onSelect={(val) => updateField('hivStatus', val)}
                isExpanded={expandedDropdown === 'hiv'}
                onToggle={() => setExpandedDropdown(expandedDropdown === 'hiv' ? null : 'hiv')}
            />
            {errors['hivStatus'] && <Text style={styles.errorText}>{errors['hivStatus']}</Text>}

            <Dropdown
                label="COVID-19 Status"
                value={formData.covidStatus}
                options={['Current infection', 'Previously infected', 'No', 'Unknown']}
                onSelect={(val) => updateField('covidStatus', val)}
                isExpanded={expandedDropdown === 'covid'}
                onToggle={() => setExpandedDropdown(expandedDropdown === 'covid' ? null : 'covid')}
            />
            {errors['covidStatus'] && <Text style={styles.errorText}>{errors['covidStatus']}</Text>}

            <RadioButtonGroup
                label="Tobacco Use"
                value={formData.tobaccoUse}
                onSelect={(val) => updateField('tobaccoUse', val)}
            />
            {errors['tobaccoUse'] && <Text style={styles.errorText}>{errors['tobaccoUse']}</Text>}

            {formData.tobaccoUse === true && (
                <Dropdown
                    label="Duration"
                    value={formData.tobaccoDuration}
                    options={['< 6 months', '6 months - 1 year', '1 - 3 years', '3 - 5 years', '> 5 years']}
                    onSelect={(val) => updateField('tobaccoDuration', val)}
                    isExpanded={expandedDropdown === 'tobaccoDuration'}
                    onToggle={() => setExpandedDropdown(expandedDropdown === 'tobaccoDuration' ? null : 'tobaccoDuration')}
                />
            )}
            {errors['tobaccoDuration'] && <Text style={styles.errorText}>{errors['tobaccoDuration']}</Text>}

            <RadioButtonGroup
                label="Alcohol Use"
                value={formData.alcoholUse}
                onSelect={(val) => updateField('alcoholUse', val)}
            />
            {errors['alcoholUse'] && <Text style={styles.errorText}>{errors['alcoholUse']}</Text>}

            {formData.alcoholUse === true && (
                <Dropdown
                    label="Duration"
                    value={formData.alcoholDuration}
                    options={['< 6 months', '6 months - 1 year', '1 - 3 years', '3 - 5 years', '> 5 years']}
                    onSelect={(val) => updateField('alcoholDuration', val)}
                    isExpanded={expandedDropdown === 'alcoholDuration'}
                    onToggle={() => setExpandedDropdown(expandedDropdown === 'alcoholDuration' ? null : 'alcoholDuration')}
                />
            )}
            {errors['alcoholDuration'] && <Text style={styles.errorText}>{errors['alcoholDuration']}</Text>}

            <RadioButtonGroup
                label="Previous TB Diagnosis"
                value={formData.previousTb}
                onSelect={(val) => updateField('previousTb', val)}
            />
            {errors['previousTb'] && <Text style={styles.errorText}>{errors['previousTb']}</Text>}

            {formData.previousTb === true && (
                <>
                    <Text style={styles.label}>Year of treatment</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="Enter year"
                        keyboardType="numeric"
                        maxLength={4}
                        value={formData.tbYear}
                        onChangeText={(text) => updateField('tbYear', text.replace(/[^0-9]/g, ''))}
                        onBlur={handleYearBlur}
                        multiline={false}
                    />

                    <Dropdown
                        label="Completed treatment?"
                        value={formData.tbTreatmentStatus}
                        options={['Yes', 'No', "Don't remember"]}
                        onSelect={(val) => updateField('tbTreatmentStatus', val)}
                        isExpanded={expandedDropdown === 'tbTreatment'}
                        onToggle={() => setExpandedDropdown(expandedDropdown === 'tbTreatment' ? null : 'tbTreatment')}
                    />
                </>
            )}
        </>
    );
};

const styles = StyleSheet.create({
    label: {
        fontSize: 14,
        color: '#475569',
        marginBottom: 8,
        marginTop: 16,
        fontWeight: '500',
    },
    input: {
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        color: '#1E293B',
        backgroundColor: 'white',
    },
    errorText: {
        color: '#EF4444',
        fontSize: 12,
        marginTop: 4,
    },
});

