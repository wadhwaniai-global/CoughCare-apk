/**
 * View Record Screen - Detailed view of a participant record
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    SafeAreaView,
    StatusBar,
    TouchableOpacity,
    ActivityIndicator,
    TextInput,
    Alert,
    ToastAndroid,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/AppNavigator';
import { getParticipantById, getRecordingsByParticipantId, saveParticipant, Participant, Recording } from '../services/DatabaseService';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CustomAlert } from '../components/ui/CustomAlert';
import { AudioPlayButton } from '../components/ui/AudioPlayButton';
import { Dropdown } from '../components/forms/Dropdown';
import { formatDateDDMMYYYY, parseDateInput } from '../utils/dateUtils';
import { gatedStatus } from '../utils/diagnosisGate';

type ViewRecordScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ViewRecord'>;
type ViewRecordScreenRouteProp = RouteProp<RootStackParamList, 'ViewRecord'>;

const ViewRecordScreen = () => {
    const navigation = useNavigation<ViewRecordScreenNavigationProp>();
    const route = useRoute<ViewRecordScreenRouteProp>();
    const insets = useSafeAreaInsets();
    const participantId = route.params?.participantId;

    const [participant, setParticipant] = useState<Participant | null>(null);
    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [loading, setLoading] = useState(true);
    const [isEditingTestResults, setIsEditingTestResults] = useState(false);
    const [saving, setSaving] = useState(false);
    const [expandedDropdown, setExpandedDropdown] = useState<string | null>(null);

    // Date picker states
    const [showCollectionPicker, setShowCollectionPicker] = useState(false);
    const [showResultPicker, setShowResultPicker] = useState(false);

    // Form data for test results
    const [testFormData, setTestFormData] = useState({
        testDone: null as string | null,
        testType: null as string | null,
        dateCollection: '',
        dateResult: '',
        testResult: null as string | null,
        testSite: null as string | null,
        testNotes: '',
    });
    const [testFormErrors, setTestFormErrors] = useState<Record<string, string>>({});

    // Custom Alert State
    const [alertConfig, setAlertConfig] = useState({
        visible: false,
        title: '',
        message: '',
        listItems: [] as string[],
        buttons: [] as any[],
        icon: 'alert-circle' as keyof typeof Ionicons.glyphMap,
        iconColor: '#EF4444'
    });

    useEffect(() => {
        loadData();
    }, [participantId]);

    // Reload data when screen comes into focus (e.g., after adding test results)
    useFocusEffect(
        React.useCallback(() => {
            if (participantId) {
                loadData();
            }
        }, [participantId])
    );

    const loadData = async () => {
        if (!participantId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const [participantData, recordingsData] = await Promise.all([
                getParticipantById(participantId),
                getRecordingsByParticipantId(participantId)
            ]);
            setParticipant(participantData);
            setRecordings(recordingsData);
        } catch (error) {
            console.error('Error loading record:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatValue = (value: any): string => {
        if (value === null || value === undefined || value === '') {
            return 'N/A';
        }
        if (typeof value === 'boolean') {
            return value ? 'Yes' : 'No';
        }
        if (typeof value === 'number') {
            if (value === -1) return 'Not answered'; // draft sentinel for unanswered yes/no fields
            if (value === 0) return 'No';
            if (value === 1) return 'Yes';
            return value.toString();
        }
        return String(value);
    };

    const getStatusBadgeColor = (status?: string) => {
        switch (status) {
            case 'synced':
                return { bg: '#DCFCE7', text: '#16A34A' };
            case 'pending': // diagnosis complete, ready to sync
                return { bg: '#E0F2FE', text: '#0284C7' };
            case 'awaiting_diagnosis':
                return { bg: '#FEF3C7', text: '#D97706' };
            case 'draft':
                return { bg: '#E0E7FF', text: '#6366F1' };
            default:
                return { bg: '#FEF3C7', text: '#D97706' };
        }
    };

    const parseSymptoms = (symptomsJson?: string) => {
        if (!symptomsJson) return {};
        try {
            return JSON.parse(symptomsJson);
        } catch {
            return {};
        }
    };

    const getRecordingLabel = (type: string): string => {
        const labels: Record<string, string> = {
            'cough_1': 'Cough Recording 1',
            'cough_2': 'Cough Recording 2',
            'cough_3': 'Cough Recording 3',
            'background': 'Ambient Sound',
        };
        return labels[type] || type;
    };

    const formatDateForInput = (dateString?: string | null): string => {
        if (!dateString) return '';

        // If already in DD/MM/YYYY format, return as is
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) {
            return dateString;
        }

        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return ''; // Handle invalid date

            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`; // Return DD/MM/YYYY
        } catch {
            return '';
        }
    };

    const handleDateChange = (event: any, selectedDate?: Date, field?: 'dateCollection' | 'dateResult') => {
        if (field === 'dateCollection') setShowCollectionPicker(false);
        if (field === 'dateResult') setShowResultPicker(false);

        if (selectedDate && field) {
            setTestFormData(prev => ({ ...prev, [field]: formatDateDDMMYYYY(selectedDate) }));
        }
    };

    const handleSaveTestResults = async () => {
        if (!participant) return;

        // Validation
        const errors: Record<string, string> = {};
        const errorList: string[] = [];

        if (!testFormData.testDone) {
            errors.testDone = 'Please select if a test was done';
            errorList.push('Was a test done? is required');
        } else if (testFormData.testDone === 'Yes') {
            if (!testFormData.testType) {
                errors.testType = 'Test Type is required';
                errorList.push('Test Type is required');
            }
            if (!testFormData.testResult) {
                errors.testResult = 'TB Diagnosis Result is required';
                errorList.push('TB Diagnosis Result is required');
            }
        }

        if (Object.keys(errors).length > 0) {
            setTestFormErrors(errors);
            setAlertConfig({
                visible: true,
                title: 'Missing Required Fields',
                message: 'Please complete the following required fields:',
                listItems: errorList,
                buttons: [{ text: 'OK', onPress: () => setAlertConfig(prev => ({ ...prev, visible: false })) }],
                icon: 'alert-circle',
                iconColor: '#EF4444'
            });
            return;
        }

        // Clear errors
        setTestFormErrors({});

        // Date Validation: Check if dates are not older than 1 month from screening date
        if (participant.date_of_screening) {
            try {
                // Parse screening date using the same robust parser (it's stored as DD/MM/YYYY)
                const screeningDateStr = parseDateInput(participant.date_of_screening);

                if (screeningDateStr) {
                    // Parse DD/MM/YYYY to Date object for calculation
                    const parts = screeningDateStr.split('/');
                    const screeningDate = new Date(Date.UTC(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])));

                    // Calculate date 1 month prior to screening (in UTC)
                    const minDate = new Date(screeningDate);
                    minDate.setUTCMonth(minDate.getUTCMonth() - 1);

                    // Helper to check date
                    const isDateTooOld = (dateStr: string) => {
                        if (!dateStr) return false;
                        const normalized = parseDateInput(dateStr); // Returns DD/MM/YYYY
                        if (!normalized) return false;

                        const dParts = normalized.split('/');
                        const checkDate = new Date(Date.UTC(parseInt(dParts[2]), parseInt(dParts[1]) - 1, parseInt(dParts[0])));
                        return checkDate < minDate;
                    };

                    // Helper to validate format strictly
                    const validateDateFormat = (dateStr: string, fieldName: string) => {
                        if (!dateStr) return true;
                        const parts = dateStr.split('/');
                        if (parts.length !== 3) {
                            ToastAndroid.show(`Invalid format for ${fieldName}. Use DD/MM/YYYY`, ToastAndroid.LONG);
                            return false;
                        }
                        const day = parseInt(parts[0]);
                        const month = parseInt(parts[1]);
                        const year = parseInt(parts[2]);

                        if (day < 1 || day > 31) {
                            ToastAndroid.show(`Invalid Day for ${fieldName}`, ToastAndroid.LONG);
                            return false;
                        }
                        if (month < 1 || month > 12) {
                            ToastAndroid.show(`Invalid Month for ${fieldName}`, ToastAndroid.LONG);
                            return false;
                        }
                        if (year < 1900 || year > 2100) {
                            ToastAndroid.show(`Invalid Year for ${fieldName}`, ToastAndroid.LONG);
                            return false;
                        }
                        const daysInMonth = new Date(year, month, 0).getDate();
                        if (day > daysInMonth) {
                            ToastAndroid.show(`Invalid Day for selected Month in ${fieldName}`, ToastAndroid.LONG);
                            return false;
                        }
                        return true;
                    };

                    if (testFormData.testDone === 'Yes') {
                        // Strict Format Validation first
                        if (!validateDateFormat(testFormData.dateCollection, 'Specimen Date')) {
                            setSaving(false);
                            return;
                        }
                        if (!validateDateFormat(testFormData.dateResult, 'Result Date')) {
                            setSaving(false);
                            return;
                        }

                        // Then Logic Validation
                        if (isDateTooOld(testFormData.dateCollection)) {
                            ToastAndroid.show('Date of Specimen Collection cannot be older than 1 month from screening date', ToastAndroid.LONG);
                            setSaving(false);
                            return;
                        }
                        if (isDateTooOld(testFormData.dateResult)) {
                            ToastAndroid.show('Date of Result cannot be older than 1 month from screening date', ToastAndroid.LONG);
                            setSaving(false);
                            return;
                        }
                    }
                }
            } catch (e) {
                console.error('Error validating dates:', e);
            }
        }

        try {
            setSaving(true);

            // Parse dates
            const dateCollection = parseDateInput(testFormData.dateCollection);
            const dateResult = parseDateInput(testFormData.dateResult);

            // Map test result values
            const mapTestResult = (result: string | null): string | null => {
                if (!result) return null;
                const mapping: Record<string, string> = {
                    'TB Positive': 'Positive',
                    'TB Negative': 'Negative',
                    'RIF Resistant': 'Inconclusive',
                    'Indeterminate': 'Inconclusive',
                    'Pending': 'Pending'
                };
                return mapping[result] || result;
            };

            // Update participant
            const isTestDone = testFormData.testDone === 'Yes';

            const testFields = {
                test_done: testFormData.testDone,
                test_type: isTestDone ? testFormData.testType : null,
                test_date_collection: isTestDone ? dateCollection : null,
                test_date_result: isTestDone ? dateResult : null,
                test_result: isTestDone ? mapTestResult(testFormData.testResult) : null,
                test_site: isTestDone ? testFormData.testSite : null,
                test_notes: isTestDone ? (testFormData.testNotes || null) : null,
            };

            const updatedParticipant = {
                ...participant,
                ...testFields,
                // Re-run the sync gate: adding a complete diagnosis promotes the
                // record to 'pending' (syncable); removing it demotes back to
                // 'awaiting_diagnosis'. Drafts and synced records never reach
                // this editor, but guard anyway.
                status: participant.status === 'pending' || participant.status === 'awaiting_diagnosis'
                    ? gatedStatus(testFields)
                    : participant.status,
            };

            await saveParticipant(updatedParticipant);

            // Update local state directly to avoid full reload freeze
            setParticipant(updatedParticipant);
            setIsEditingTestResults(false);
            setExpandedDropdown(null);

            Alert.alert('Success', 'Test results saved successfully!');
        } catch (error) {
            console.error('Error saving test results:', error);
            Alert.alert('Error', 'Failed to save test results. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <StatusBar barStyle="light-content" backgroundColor="#2563EB" />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#2563EB" />
                    <Text style={styles.loadingText}>Loading record...</Text>
                </View>
            </SafeAreaView>
        );
    }

    if (!participant) {
        return (
            <SafeAreaView style={styles.container}>
                <StatusBar barStyle="light-content" backgroundColor="#2563EB" />
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color="white" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>View Record</Text>
                </View>
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>Record not found</Text>
                </View>
            </SafeAreaView>
        );
    }

    const symptoms = parseSymptoms(participant.symptoms);
    const statusBadge = getStatusBadgeColor(participant.status);
    const analysisResult = participant.analysis_result ? JSON.parse(participant.analysis_result) : null;

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor="#2563EB" />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="white" />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>View Record</Text>
                    {(participant.status === 'pending' || participant.status === 'awaiting_diagnosis') && (
                        <Text style={styles.headerSubtitle}>Can add test results</Text>
                    )}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusBadge.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: statusBadge.text }]}>
                        {participant.status === 'synced' ? 'Synced'
                            : participant.status === 'pending' ? 'Pending Sync'
                            : participant.status === 'awaiting_diagnosis' ? 'Awaiting Diagnosis'
                            : 'Draft'}
                    </Text>
                </View>
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
            >
                <ScrollView
                    style={styles.content}
                    contentContainerStyle={{ paddingBottom: 40 }}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Individual Details */}
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="person" size={20} color="#2563EB" style={{ marginRight: 8 }} />
                            <Text style={styles.sectionTitle}>Individual Details</Text>
                        </View>
                        <View style={styles.sectionContent}>
                            <InfoRow label="Participant ID" value={formatValue(participant.participant_id)} />

                            <InfoRow label="Mobile Number" value={formatValue(participant.mobile_number)} />
                            <InfoRow label="Age" value={participant.age ? `${participant.age} years` : 'N/A'} />
                            <InfoRow label="Gender" value={formatValue(participant.gender)} />
                            <InfoRow label="Screening Date" value={formatValue(participant.date_of_screening)} />
                            <InfoRow
                                label="Consent"
                                value={participant.consent_obtained === 1 ? 'Yes' : participant.consent_obtained === 0 ? 'No' : 'Not answered'}
                                highlight={participant.consent_obtained === 1}
                            />
                        </View>
                    </View>

                    {/* Location */}
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="location" size={20} color="#2563EB" style={{ marginRight: 8 }} />
                            <Text style={styles.sectionTitle}>Location</Text>
                        </View>
                        <View style={styles.sectionContent}>
                            <InfoRow label="Region" value={formatValue(participant.region)} />
                            <InfoRow label="District" value={formatValue(participant.district)} />
                            <InfoRow label="Facility" value={formatValue(participant.facility)} />
                            {participant.community && (
                                <InfoRow label="Community" value={formatValue(participant.community)} />
                            )}
                        </View>
                    </View>

                    {/* Health History */}
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="pulse" size={20} color="#2563EB" style={{ marginRight: 8 }} />
                            <Text style={styles.sectionTitle}>Health History</Text>
                        </View>
                        <View style={styles.sectionContent}>
                            <InfoRow label="Diabetes" value={formatValue(participant.diabetes_status)} />
                            <InfoRow label="HIV Status" value={formatValue(participant.hiv_status)} />
                            <InfoRow label="COVID-19" value={formatValue(participant.covid_status)} />
                            <InfoRow label="Tobacco Use" value={formatValue(participant.tobacco_use)} />
                            {participant.tobacco_use === 1 && participant.tobacco_duration && (
                                <InfoRow label="Tobacco Duration" value={formatValue(participant.tobacco_duration)} />
                            )}
                            <InfoRow label="Alcohol Use" value={formatValue(participant.alcohol_use_frequency ?? participant.alcohol_use)} />
                            {participant.alcohol_use === 1 && participant.alcohol_duration && (
                                <InfoRow label="Alcohol Duration" value={formatValue(participant.alcohol_duration)} />
                            )}
                            <InfoRow label="Previous TB" value={formatValue(participant.previous_tb)} />
                            {participant.previous_tb === 1 && participant.last_tb_year && (
                                <InfoRow label="Last TB Year" value={formatValue(participant.last_tb_year)} />
                            )}
                            {participant.previous_tb === 1 && participant.tb_treatment_completed && (
                                <InfoRow label="TB Treatment Completed" value={formatValue(participant.tb_treatment_completed)} />
                            )}
                            {participant.previous_tb === 1 && participant.recurring_tb != null && (
                                <InfoRow label="Recurring TB" value={formatValue(participant.recurring_tb)} />
                            )}
                        </View>
                    </View>

                    {/* Symptoms */}
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="pulse" size={20} color="#EF4444" style={{ marginRight: 8 }} />
                            <Text style={styles.sectionTitle}>Symptoms</Text>
                        </View>
                        <View style={styles.sectionContent}>
                            {Object.keys(symptoms).length === 0 ? (
                                <Text style={styles.emptyText}>No symptoms reported</Text>
                            ) : (
                                <>
                                    {Object.entries(symptoms).map(([key, value]: [string, any]) => {
                                        if (value?.present === true) {
                                            return (
                                                <InfoRow
                                                    key={key}
                                                    label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                                                    value={value.duration ? `${value.duration} days` : 'Yes'}
                                                />
                                            );
                                        }
                                        return null;
                                    })}
                                </>
                            )}
                        </View>
                    </View>

                    {/* Audio Recordings */}
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="mic" size={20} color="#2563EB" style={{ marginRight: 8 }} />
                            <Text style={styles.sectionTitle}>Audio Recordings</Text>
                        </View>
                        <View style={styles.sectionContent}>
                            {(() => {
                                // Create a map to ensure we only show one recording per type (latest if duplicates exist)
                                const recordingMap = new Map<string, Recording>();
                                recordings.forEach(rec => {
                                    const existing = recordingMap.get(rec.recording_type);
                                    if (!existing || (rec.id && existing.id && rec.id > existing.id)) {
                                        recordingMap.set(rec.recording_type, rec);
                                    }
                                });

                                // Show all 4 recording types, with actual data if available
                                const recordingTypes = ['cough_1', 'cough_2', 'cough_3', 'background'];
                                return recordingTypes.map(type => {
                                    const recording = recordingMap.get(type);
                                    return (
                                        <View key={type} style={styles.infoRow}>
                                            <Text style={styles.infoLabel}>{getRecordingLabel(type)}</Text>
                                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                <Text style={styles.infoValue}>
                                                    {recording && recording.duration
                                                        ? `${recording.duration} seconds`
                                                        : 'Not recorded'}
                                                </Text>
                                                {recording?.file_path ? (
                                                    <AudioPlayButton uri={recording.file_path} compact />
                                                ) : null}
                                            </View>
                                        </View>
                                    );
                                });
                            })()}
                        </View>
                    </View>

                    {/* Analysis Results */}
                    {analysisResult && (
                        <View style={styles.section}>
                            <View style={styles.sectionHeader}>
                                <Ionicons name="analytics" size={20} color="#2563EB" style={{ marginRight: 8 }} />
                                <Text style={styles.sectionTitle}>Analysis Results</Text>
                            </View>
                            <View style={styles.sectionContent}>
                                <InfoRow
                                    label="Cough Detected"
                                    value={analysisResult.coughDetected ? 'Yes' : 'No'}
                                    highlight={analysisResult.coughDetected}
                                />
                                {analysisResult.confidence && (
                                    <InfoRow
                                        label="Confidence"
                                        value={`${(analysisResult.confidence * 100).toFixed(1)}%`}
                                    />
                                )}
                            </View>
                        </View>
                    )}

                    {/* Diagnostic Testing */}
                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="document-text" size={20} color="#2563EB" style={{ marginRight: 8 }} />
                            <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text style={styles.sectionTitle}>Diagnostic Testing</Text>
                                {/* Only show Add Results button if unsynced and not editing */}
                                {(participant.status === 'pending' || participant.status === 'awaiting_diagnosis') && !isEditingTestResults && (
                                    <TouchableOpacity
                                        style={styles.addButton}
                                        onPress={() => {
                                            // Initialize form with existing data
                                            setTestFormData({
                                                testDone: participant.test_done || null,
                                                testType: participant.test_type || null,
                                                dateCollection: participant.test_date_collection ? formatDateForInput(participant.test_date_collection) : '',
                                                dateResult: participant.test_date_result ? formatDateForInput(participant.test_date_result) : '',
                                                testResult: participant.test_result || null,
                                                testSite: participant.test_site || null,
                                                testNotes: participant.test_notes || '',
                                            });
                                            setIsEditingTestResults(true);
                                        }}
                                    >
                                        <Ionicons name="pencil" size={16} color="#2563EB" style={{ marginRight: 4 }} />
                                        <Text style={styles.addButtonText}>Add Results</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                        <View style={styles.sectionContent}>
                            {isEditingTestResults ? (
                                // Edit Form
                                <View style={styles.testFormContainer}>
                                    <Dropdown
                                        label="Was a test done? *"
                                        value={testFormData.testDone}
                                        options={['Yes', 'No', 'Not yet']}
                                        onSelect={(val: string) => {
                                            const value = val; // No 'Select' option anymore
                                            if (val === 'No' || val === 'Not yet') {
                                                setTestFormData({
                                                    ...testFormData,
                                                    testDone: value,
                                                    testType: null,
                                                    dateCollection: '',
                                                    dateResult: '',
                                                    testResult: null,
                                                    testSite: null,
                                                    testNotes: '',
                                                });
                                                // Clear errors when switching to No/Not yet
                                                setTestFormErrors({});
                                            } else {
                                                setTestFormData({ ...testFormData, testDone: value });
                                                // Clear specific error
                                                if (testFormErrors.testDone) {
                                                    setTestFormErrors(prev => {
                                                        const newErrors = { ...prev };
                                                        delete newErrors.testDone;
                                                        return newErrors;
                                                    });
                                                }
                                            }
                                        }}
                                        isExpanded={expandedDropdown === 'testDone'}
                                        onToggle={() => setExpandedDropdown(expandedDropdown === 'testDone' ? null : 'testDone')}
                                        placeholder="Select"
                                        error={testFormErrors.testDone}
                                    />

                                    {testFormData.testDone === 'Yes' && (
                                        <>
                                            <Dropdown
                                                label="Test Type *"
                                                value={testFormData.testType}
                                                options={[
                                                    'GeneXpert',
                                                    'Smear Microscopy',
                                                    'Culture',
                                                    'Chest X-Ray (CXR)',
                                                    'Other'
                                                ]}
                                                onSelect={(val: string) => {
                                                    setTestFormData({ ...testFormData, testType: val });
                                                    if (testFormErrors.testType) {
                                                        setTestFormErrors(prev => {
                                                            const newErrors = { ...prev };
                                                            delete newErrors.testType;
                                                            return newErrors;
                                                        });
                                                    }
                                                }}
                                                isExpanded={expandedDropdown === 'testType'}
                                                onToggle={() => setExpandedDropdown(expandedDropdown === 'testType' ? null : 'testType')}
                                                placeholder="Select test type"
                                                error={testFormErrors.testType}
                                            />

                                            <View style={styles.formGroup}>
                                                <Text style={styles.formLabel}>Date of Specimen Collection</Text>
                                                <View style={styles.dateContainer}>
                                                    <TextInput
                                                        style={[styles.formInput, styles.dateInput]}
                                                        placeholder="DD/MM/YYYY"
                                                        value={testFormData.dateCollection}
                                                        onChangeText={(text) => {
                                                            let cleaned = text.replace(/\D/g, '');
                                                            let formatted = cleaned;
                                                            if (cleaned.length > 2) {
                                                                formatted = cleaned.slice(0, 2) + '/' + cleaned.slice(2);
                                                            }
                                                            if (cleaned.length > 4) {
                                                                formatted = formatted.slice(0, 5) + '/' + cleaned.slice(4, 8);
                                                            }
                                                            setTestFormData({ ...testFormData, dateCollection: formatted });
                                                        }}
                                                        keyboardType="numeric"
                                                        maxLength={10}
                                                    />
                                                    <TouchableOpacity onPress={() => setShowCollectionPicker(true)} style={styles.dateIconBtn}>
                                                        <Ionicons name="calendar-outline" size={24} color="#64748B" />
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                            {showCollectionPicker && (
                                                <DateTimePicker
                                                    value={new Date()}
                                                    mode="date"
                                                    display="default"
                                                    maximumDate={new Date()}
                                                    onChange={(e, date) => handleDateChange(e, date, 'dateCollection')}
                                                />
                                            )}

                                            <View style={styles.formGroup}>
                                                <Text style={styles.formLabel}>Date of Result</Text>
                                                <View style={styles.dateContainer}>
                                                    <TextInput
                                                        style={[styles.formInput, styles.dateInput]}
                                                        placeholder="DD/MM/YYYY"
                                                        value={testFormData.dateResult}
                                                        onChangeText={(text) => {
                                                            let cleaned = text.replace(/\D/g, '');
                                                            let formatted = cleaned;
                                                            if (cleaned.length > 2) {
                                                                formatted = cleaned.slice(0, 2) + '/' + cleaned.slice(2);
                                                            }
                                                            if (cleaned.length > 4) {
                                                                formatted = formatted.slice(0, 5) + '/' + cleaned.slice(4, 8);
                                                            }
                                                            setTestFormData({ ...testFormData, dateResult: formatted });
                                                        }}
                                                        keyboardType="numeric"
                                                        maxLength={10}
                                                    />
                                                    <TouchableOpacity onPress={() => setShowResultPicker(true)} style={styles.dateIconBtn}>
                                                        <Ionicons name="calendar-outline" size={24} color="#64748B" />
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                            {showResultPicker && (
                                                <DateTimePicker
                                                    value={new Date()}
                                                    mode="date"
                                                    display="default"
                                                    maximumDate={new Date()}
                                                    onChange={(e, date) => handleDateChange(e, date, 'dateResult')}
                                                />
                                            )}

                                            <Dropdown
                                                label="TB Diagnosis Result *"
                                                value={testFormData.testResult}
                                                options={[
                                                    'Positive',
                                                    'Negative',
                                                    'Pending',
                                                    'Inconclusive',
                                                    'Not done'
                                                ]}
                                                onSelect={(val: string) => {
                                                    setTestFormData({ ...testFormData, testResult: val });
                                                    if (testFormErrors.testResult) {
                                                        setTestFormErrors(prev => {
                                                            const newErrors = { ...prev };
                                                            delete newErrors.testResult;
                                                            return newErrors;
                                                        });
                                                    }
                                                }}
                                                isExpanded={expandedDropdown === 'testResult'}
                                                onToggle={() => setExpandedDropdown(expandedDropdown === 'testResult' ? null : 'testResult')}
                                                placeholder="Select result"
                                                error={testFormErrors.testResult}
                                            />

                                            <Dropdown
                                                label="Site of Disease"
                                                value={testFormData.testSite}
                                                options={[
                                                    'Pulmonary',
                                                    'Extra-pulmonary',
                                                    'Both',
                                                    'Unknown'
                                                ]}
                                                onSelect={(val: string) => {
                                                    setTestFormData({ ...testFormData, testSite: val });
                                                }}
                                                isExpanded={expandedDropdown === 'testSite'}
                                                onToggle={() => setExpandedDropdown(expandedDropdown === 'testSite' ? null : 'testSite')}
                                                placeholder="Select site"
                                            />

                                            <View style={styles.formGroup}>
                                                <Text style={styles.formLabel}>Additional Notes (Optional)</Text>
                                                <TextInput
                                                    style={[styles.formInput, styles.textArea]}
                                                    placeholder="Enter any additional notes"
                                                    value={testFormData.testNotes}
                                                    onChangeText={(text) => {
                                                        setTestFormData({ ...testFormData, testNotes: text });
                                                    }}
                                                    multiline
                                                    numberOfLines={4}
                                                    textAlignVertical="top"
                                                />
                                            </View>
                                        </>
                                    )}
                                </View>
                            ) : (
                                // View Mode
                                <>
                                    {!participant.test_done || participant.test_done === 'Not yet' || participant.test_done === 'No' ? (
                                        <>
                                            {participant.test_done && (
                                                <InfoRow label="Test Done" value={formatValue(participant.test_done)} />
                                            )}
                                            {(!participant.test_done || participant.test_done === 'Not yet') && (
                                                <Text style={styles.emptyText}>No diagnostic testing results added yet</Text>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <InfoRow label="Test Done" value={formatValue(participant.test_done)} />
                                            {participant.test_type && (
                                                <InfoRow label="Test Type" value={formatValue(participant.test_type)} />
                                            )}
                                            {participant.test_date_collection && (
                                                <InfoRow label="Collection Date" value={formatValue(participant.test_date_collection)} />
                                            )}
                                            {participant.test_date_result && (
                                                <InfoRow label="Result Date" value={formatValue(participant.test_date_result)} />
                                            )}
                                            {participant.test_result && (
                                                <InfoRow
                                                    label="Result"
                                                    value={formatValue(participant.test_result)}
                                                    highlight={participant.test_result === 'Positive' || participant.test_result === 'TB Positive'}
                                                />
                                            )}
                                            {participant.test_site && (
                                                <InfoRow label="Site" value={formatValue(participant.test_site)} />
                                            )}
                                            {participant.test_notes && (
                                                <InfoRow label="Notes" value={formatValue(participant.test_notes)} />
                                            )}
                                        </>
                                    )}
                                </>
                            )}
                        </View>
                    </View>

                </ScrollView>

                {/* Cancel and Save Results Buttons - Only show when editing */}
                {
                    isEditingTestResults && (
                        <View style={[styles.footer, { paddingBottom: Math.max(12 + insets.bottom * 2, 44) }]}>
                            <TouchableOpacity
                                style={styles.cancelButton}
                                onPress={() => {
                                    setIsEditingTestResults(false);
                                    setExpandedDropdown(null);
                                }}
                                disabled={saving}
                            >
                                <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                                onPress={handleSaveTestResults}
                                disabled={saving}
                            >
                                {saving ? (
                                    <Text style={styles.saveButtonText}>Saving...</Text>
                                ) : (
                                    <>
                                        <Ionicons name="document-text" size={18} color="white" style={{ marginRight: 6 }} />
                                        <Text style={styles.saveButtonText}>Save Results</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>
                    )
                }

                {/* Edit button - drafts and not-yet-synced records only. Synced
                    records are immutable (the server has them already). */}
                {(participant.status === 'draft' || participant.status === 'pending' || participant.status === 'awaiting_diagnosis') && (
                    <View style={[styles.footer, { paddingBottom: Math.max(12 + insets.bottom * 2, 44) }]}>
                        <TouchableOpacity
                            style={styles.editDraftButton}
                            onPress={() => navigation.navigate('NewParticipant', { draftId: participant.participant_id })}
                        >
                            <Ionicons name="create-outline" size={18} color="white" style={{ marginRight: 6 }} />
                            <Text style={styles.editDraftButtonText}>
                                {participant.status === 'draft' ? 'Edit Draft' : 'Edit Record'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}
            </KeyboardAvoidingView>
            {/* Custom Alert */}
            <CustomAlert
                visible={alertConfig.visible}
                title={alertConfig.title}
                message={alertConfig.message}
                listItems={alertConfig.listItems}
                buttons={alertConfig.buttons}
                onClose={() => setAlertConfig(prev => ({ ...prev, visible: false }))}
                icon={alertConfig.icon}
                iconColor={alertConfig.iconColor}
            />
        </SafeAreaView >
    );
};

// Info Row Component
const InfoRow: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
    <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>{label}</Text>
        <View style={styles.infoValueContainer}>
            {highlight && value === 'Yes' ? (
                <View style={styles.highlightBadge}>
                    <Text style={styles.highlightText}>{value}</Text>
                </View>
            ) : (
                <Text style={[styles.infoValue, highlight && value === 'Positive' && styles.positiveValue]}>
                    {value}
                </Text>
            )}
        </View>
    </View>
);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    header: {
        backgroundColor: '#2563EB',
        padding: 16,
        paddingTop: 40,
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButton: {
        marginRight: 16,
    },
    headerTitle: {
        color: 'white',
        fontSize: 18,
        fontWeight: '600',
    },
    headerSubtitle: {
        color: '#BFDBFE',
        fontSize: 12,
        marginTop: 2,
    },
    statusBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
    },
    statusBadgeText: {
        fontSize: 12,
        fontWeight: '600',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        color: '#64748B',
        fontSize: 14,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    errorText: {
        color: '#EF4444',
        fontSize: 16,
    },
    section: {
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 16,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1E293B',
    },
    sectionContent: {
        padding: 16,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    infoLabel: {
        fontSize: 14,
        color: '#64748B',
        flex: 1,
    },
    infoValueContainer: {
        flex: 1,
        alignItems: 'flex-end',
    },
    infoValue: {
        fontSize: 14,
        color: '#1E293B',
        fontWeight: '500',
        textAlign: 'right',
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
    highlightBadge: {
        backgroundColor: '#DCFCE7',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    highlightText: {
        color: '#16A34A',
        fontSize: 12,
        fontWeight: '600',
    },
    positiveValue: {
        color: '#EF4444',
        fontWeight: '600',
    },
    emptyText: {
        fontSize: 14,
        color: '#94A3B8',
        fontStyle: 'italic',
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: '#EFF6FF',
    },
    addButtonText: {
        color: '#2563EB',
        fontSize: 12,
        fontWeight: '600',
    },
    addTestButton: {
        backgroundColor: '#2563EB',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    addTestButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    testFormContainer: {
        paddingVertical: 8,
    },
    formGroup: {
        marginBottom: 16,
    },
    formLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1E293B',
        marginBottom: 8,
    },
    formInput: {
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 8,
        padding: 12,
        fontSize: 14,
        color: '#1E293B',
        backgroundColor: '#FFFFFF',
    },
    textArea: {
        minHeight: 100,
        textAlignVertical: 'top',
    },
    footer: {
        flexDirection: 'row',
        padding: 12,
        backgroundColor: 'white',
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
        gap: 12,
    },
    editDraftButton: {
        flex: 1,
        padding: 12,
        borderRadius: 8,
        backgroundColor: '#2563EB',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    editDraftButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    cancelButton: {
        flex: 1,
        padding: 12,
        borderRadius: 8,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
    },
    cancelButtonText: {
        color: '#64748B',
        fontSize: 16,
        fontWeight: '600',
    },
    saveButton: {
        flex: 1,
        padding: 12,
        borderRadius: 8,
        backgroundColor: '#22C55E',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveButtonDisabled: {
        backgroundColor: '#94A3B8',
    },
    saveButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default ViewRecordScreen;

