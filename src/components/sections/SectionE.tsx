/**
 * Section E: Diagnostic Testing
 */

import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Platform, ToastAndroid, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Dropdown } from '../forms/Dropdown';
import { ParticipantFormData } from '../../types/participantForm';

interface SectionEProps {
    formData: ParticipantFormData;
    updateField: <K extends keyof ParticipantFormData>(field: K, value: ParticipantFormData[K]) => void;
    expandedDropdown: string | null;
    setExpandedDropdown: (key: string | null) => void;
    errors?: Record<string, string>;
}

export const SectionE: React.FC<SectionEProps> = ({
    formData,
    updateField,
    expandedDropdown,
    setExpandedDropdown,
    errors = {},
}) => {
    const [showCollectionPicker, setShowCollectionPicker] = useState(false);
    const [showResultPicker, setShowResultPicker] = useState(false);

    const showToast = (message: string) => {
        if (Platform.OS === 'android') {
            ToastAndroid.show(message, ToastAndroid.SHORT);
        } else {
            Alert.alert('Notice', message);
        }
    };

    const handleTextChange = (field: keyof ParticipantFormData, text: string, maxLength: number = 1000) => {
        if (text.length >= maxLength) {
            showToast(`Maximum character limit (${maxLength}) reached`);
            updateField(field, text.slice(0, maxLength));
        } else {
            updateField(field, text);
        }
    };

    const handleDateChange = (event: any, selectedDate?: Date, field?: 'testDateCollection' | 'testDateResult') => {
        if (field === 'testDateCollection') setShowCollectionPicker(false);
        if (field === 'testDateResult') setShowResultPicker(false);

        if (selectedDate && field) {
            const day = selectedDate.getDate().toString().padStart(2, '0');
            const month = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
            const year = selectedDate.getFullYear();
            updateField(field, `${day}/${month}/${year}`);
        }
    };

    const handleManualDateChange = (text: string, field: 'testDateCollection' | 'testDateResult') => {
        // Simple date mask: DD/MM/YYYY
        let cleaned = text.replace(/\D/g, '');
        let formatted = cleaned;
        if (cleaned.length > 2) {
            formatted = cleaned.slice(0, 2) + '/' + cleaned.slice(2);
        }
        if (cleaned.length > 4) {
            formatted = formatted.slice(0, 5) + '/' + cleaned.slice(4, 8);
        }
        updateField(field, formatted);
    };

    return (
        <>
            <Dropdown
                label="Test Result"
                value={formData.testResult}
                options={['Positive', 'Negative', 'Indeterminate', 'Pending']}
                onSelect={(val) => updateField('testResult', val)}
                isExpanded={expandedDropdown === 'testResult'}
                onToggle={() => setExpandedDropdown(expandedDropdown === 'testResult' ? null : 'testResult')}
                placeholder="Select Result"
            />
            {errors['testResult'] && <Text style={styles.errorText}>{errors['testResult']}</Text>}

            <Text style={styles.label}>Date of Sample Collection</Text>
            <View style={styles.dateContainer}>
                <TextInput
                    style={[styles.input, styles.dateInput, errors['testDateCollection'] && styles.inputError]}
                    placeholder="DD/MM/YYYY"
                    keyboardType="numeric"
                    maxLength={10}
                    value={formData.testDateCollection}
                    onChangeText={(text) => handleManualDateChange(text, 'testDateCollection')}
                />
                <TouchableOpacity onPress={() => setShowCollectionPicker(true)} style={styles.dateIconBtn}>
                    <Ionicons name="calendar-outline" size={24} color="#64748B" />
                </TouchableOpacity>
            </View>
            {errors['testDateCollection'] && <Text style={styles.errorText}>{errors['testDateCollection']}</Text>}

            {showCollectionPicker && (
                <DateTimePicker
                    value={new Date()}
                    mode="date"
                    display="default"
                    maximumDate={new Date()}
                    onChange={(e, date) => handleDateChange(e, date, 'testDateCollection')}
                />
            )}

            <Text style={styles.label}>Date of Result</Text>
            <View style={styles.dateContainer}>
                <TextInput
                    style={[styles.input, styles.dateInput, errors['testDateResult'] && styles.inputError]}
                    placeholder="DD/MM/YYYY"
                    keyboardType="numeric"
                    maxLength={10}
                    value={formData.testDateResult}
                    onChangeText={(text) => handleManualDateChange(text, 'testDateResult')}
                />
                <TouchableOpacity onPress={() => setShowResultPicker(true)} style={styles.dateIconBtn}>
                    <Ionicons name="calendar-outline" size={24} color="#64748B" />
                </TouchableOpacity>
            </View>
            {errors['testDateResult'] && <Text style={styles.errorText}>{errors['testDateResult']}</Text>}

            {showResultPicker && (
                <DateTimePicker
                    value={new Date()}
                    mode="date"
                    display="default"
                    maximumDate={new Date()}
                    onChange={(e, date) => handleDateChange(e, date, 'testDateResult')}
                />
            )}

            <Dropdown
                label="Test Type"
                value={formData.testType}
                options={['GeneXpert', 'Smear Microscopy', 'Culture', 'Chest X-ray']}
                onSelect={(val) => updateField('testType', val)}
                isExpanded={expandedDropdown === 'testType'}
                onToggle={() => setExpandedDropdown(expandedDropdown === 'testType' ? null : 'testType')}
                placeholder="Select Test Type"
            />
            {errors['testType'] && <Text style={styles.errorText}>{errors['testType']}</Text>}

            <Text style={styles.label}>Test Site</Text>
            <TextInput
                style={[styles.input, errors['testSite'] && styles.inputError]}
                placeholder="Enter test site"
                value={formData.testSite}
                maxLength={1000}
                onChangeText={(text) => handleTextChange('testSite', text)}
            />
            {errors['testSite'] && <Text style={styles.errorText}>{errors['testSite']}</Text>}

            <Text style={styles.label}>Notes (Optional)</Text>
            <TextInput
                style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                placeholder="Enter notes"
                multiline
                numberOfLines={3}
                maxLength={1000}
                value={formData.testNotes}
                onChangeText={(text) => handleTextChange('testNotes', text)}
            />
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
    inputError: {
        borderColor: '#EF4444',
    },
    dateContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dateInput: {
        flex: 1,
    },
    dateIconBtn: {
        marginLeft: 8,
        padding: 10,
        backgroundColor: '#F1F5F9',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    errorText: {
        color: '#EF4444',
        fontSize: 12,
        marginTop: 4,
    },
});
