import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    SafeAreaView,
    StatusBar,
    LayoutAnimation,
    Platform,
    UIManager,
    ActivityIndicator,
    Alert,
    Modal
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { Asset } from 'expo-asset';
import { saveParticipant, saveRecording, getDB, getParticipantById, getRecordingsByParticipantId } from '../services/DatabaseService';
import { useParticipantForm } from '../hooks/useParticipantForm';
import { useAudioRecording } from '../hooks/useAudioRecording';
import { validateForm, formatValidationErrors } from '../utils/formValidation';
import { AlcoholUse, ParticipantFormData } from '../types/participantForm';
import { todayDDMMYYYY } from '../utils/dateUtils';
import { AccordionSection } from '../components/forms/AccordionSection';
import { SectionA } from '../components/sections/SectionA';
import { SectionB } from '../components/sections/SectionB';
import { SectionC } from '../components/sections/SectionC';
import { SectionD } from '../components/sections/SectionD';
import { CustomAlert } from '../components/ui/CustomAlert';
import { useAuth } from '../contexts/AuthContext';

if (Platform.OS === 'android') {
    if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
    }
}

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'NewParticipant'>;
type NewParticipantRouteProp = RouteProp<RootStackParamList, 'NewParticipant'>;

const NewParticipantScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<NewParticipantRouteProp>();
    const draftId = route.params?.draftId;
    const [isEditingDraft] = useState(!!draftId);
    const [isLoadingDraft, setIsLoadingDraft] = useState(!!draftId);
    // Status of the record being edited ('draft' | 'pending') — pending records
    // can be corrected until they are synced.
    const [editingStatus, setEditingStatus] = useState<string | null>(null);
    const insets = useSafeAreaInsets();
    const { profile, username } = useAuth();
    const [expandedSection, setExpandedSection] = useState<string | null>('A');
    const [expandedDropdown, setExpandedDropdown] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showValidationModal, setShowValidationModal] = useState(false);
    const [validationErrors, setValidationErrors] = useState<string>('');
    const [inlineErrors, setInlineErrors] = useState<Record<string, string>>({});
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [successMessage, setSuccessMessage] = useState('Participant saved successfully!');

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

    // Use custom hooks
    const { formData, setFormData, updateField, updateSymptom } = useParticipantForm(
        draftId ? { participantId: draftId } : undefined,
        profile,
    );
    const {
        activeRecordingKey,
        recordingDuration,
        recordedDurations,
        analysisResults,
        startRecording,
        stopRecording,
        clearRecording,
        analyzeAudioManually,
        initRecordedDurations,
    } = useAudioRecording();

    React.useEffect(() => {
        if (!draftId) return;
        const loadDraft = async () => {
            try {
                const participant = await getParticipantById(draftId);
                if (!participant) return;
                setEditingStatus(participant.status || 'draft');

                // Parse GPS tag out of the packed address field
                const rawAddress = participant.address || '';
                const gpsMatch = rawAddress.match(/\[GPS:([-\d.]+),([-\d.]+)\]/);
                const cleanAddress = rawAddress.replace(/\n?\[GPS:[-\d.]+,[-\d.]+\]/, '').trim();

                setFormData(prev => ({
                    ...prev,
                    participantId: participant.participant_id,
                    mobileNumber: participant.mobile_number || '',
                    age: participant.age ? String(participant.age) : '',
                    gender: participant.gender || null,
                    address: cleanAddress,
                    dateOfScreening: participant.date_of_screening || todayDDMMYYYY(),
                    community: participant.community || '',
                    gpsLatitude: gpsMatch ? gpsMatch[1] : null,
                    gpsLongitude: gpsMatch ? gpsMatch[2] : null,
                    consentObtained: participant.consent_obtained === 1 ? true : participant.consent_obtained === 0 ? false : null,
                    diabetesStatus: participant.diabetes_status || null,
                    hivStatus: participant.hiv_status || null,
                    covidStatus: participant.covid_status || null,
                    tobaccoUse: participant.tobacco_use === 1 ? true : participant.tobacco_use === 0 ? false : null,
                    tobaccoDuration: participant.tobacco_duration || null,
                    alcoholUse: (participant.alcohol_use_frequency as AlcoholUse)
                        ?? (participant.alcohol_use === 1 ? 'Yes' : participant.alcohol_use === 0 ? 'No' : null),
                    alcoholDuration: participant.alcohol_duration || null,
                    previousTb: participant.previous_tb === 1 ? true : participant.previous_tb === 0 ? false : null,
                    tbYear: participant.last_tb_year || '',
                    tbTreatmentStatus: participant.tb_treatment_completed || null,
                    recurringTb: participant.recurring_tb === 1 ? true : participant.recurring_tb === 0 ? false : null,
                    symptoms: participant.symptoms ? JSON.parse(participant.symptoms) : {},
                }));

                const recordings = await getRecordingsByParticipantId(draftId);
                const recordingMap: Record<string, string> = {};
                const durationMap: Record<string, number> = {};
                for (const rec of recordings) {
                    const formKey = rec.recording_type === 'cough_1' ? 'recording1'
                        : rec.recording_type === 'cough_2' ? 'recording2'
                        : rec.recording_type === 'cough_3' ? 'recording3'
                        : rec.recording_type === 'background' ? 'recordingBackground'
                        : null;
                    if (formKey && rec.file_path) {
                        recordingMap[formKey] = rec.file_path;
                        if (rec.duration) durationMap[formKey] = rec.duration;
                    }
                }
                if (Object.keys(recordingMap).length > 0) {
                    setFormData(prev => ({ ...prev, ...recordingMap }));
                }
                if (Object.keys(durationMap).length > 0) {
                    initRecordedDurations(durationMap);
                }
            } catch (error) {
                console.error('Error loading draft:', error);
            } finally {
                setIsLoadingDraft(false);
            }
        };
        loadDraft();
    }, [draftId]);

    // Section that should be scrolled to the top of the viewport once its
    // post-expansion position is known. Expanding a section collapses the one
    // above it, which shifts the layout after the scroll offset was set — so
    // the scroll must happen from onLayout, which fires with the final frame.
    const pendingScrollSection = React.useRef<string | null>(null);

    const toggleSection = (section: string) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        const opening = expandedSection !== section;
        setExpandedSection(opening ? section : null);
        if (opening) {
            pendingScrollSection.current = section;
        }
    };

    const scrollViewRef = React.useRef<ScrollView>(null);
    const [sectionLayouts, setSectionLayouts] = useState<Record<string, number>>({});

    const onSectionLayout = (section: string, event: any) => {
        const layout = event.nativeEvent.layout;
        setSectionLayouts(prev => ({ ...prev, [section]: layout.y }));
        if (pendingScrollSection.current === section) {
            pendingScrollSection.current = null;
            scrollViewRef.current?.scrollTo({ y: Math.max(0, layout.y - 8), animated: true });
        }
    };

    const handleUpdateField = <K extends keyof ParticipantFormData>(field: K, value: ParticipantFormData[K]) => {
        updateField(field, value);
        // Clear error for this field if it exists
        if (inlineErrors[field as string]) {
            setInlineErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[field as string];
                return newErrors;
            });
        }
    };

    const handleUpdateSymptom = (key: string, updates: { present?: boolean | null; duration?: string }) => {
        updateSymptom(key, updates);
        // Clear errors related to this symptom
        setInlineErrors(prev => {
            const newErrors = { ...prev };
            if (updates.present !== undefined) {
                delete newErrors[`symptoms.${key}`];
            }
            if (updates.duration !== undefined) {
                delete newErrors[`symptoms.${key}.duration`];
            }
            return newErrors;
        });
    };

    // Close sections B, C, D if consent is revoked
    React.useEffect(() => {
        if (formData.consentObtained !== true && expandedSection && expandedSection !== 'A') {
            setExpandedSection('A');
        }
    }, [formData.consentObtained]);

    const handleUseSample = async (key: string) => {
        try {
            let uri;
            if (Platform.OS === 'web') {
                uri = '/samples/sample-cough.webm';
            } else {
                const asset = Asset.fromModule(require('../../assets/audio/20251104_150725_454926_cough.wav'));
                await asset.downloadAsync();
                uri = asset.localUri || asset.uri;
            }

            if (uri) {
                handleUpdateField(key as keyof typeof formData, uri);
                // Trigger analysis for sample audio using the hook's method
                await analyzeAudioManually(key, uri);
            }
        } catch (err) {
            console.error('Error loading sample', err);
            Alert.alert('Error', 'Failed to load sample audio.');
        }
    };

    const handleSaveDraft = async () => {
        try {
            console.log('Save Draft button clicked');
            setIsSubmitting(true);

            // Check for existing participant with same ID (skip when editing a draft)
            if (formData.participantId && !isEditingDraft) {
                const existing = await getParticipantById(formData.participantId);
                if (existing) {
                    setAlertConfig({
                        visible: true,
                        title: 'Error',
                        message: 'Participant ID already exists. Please use a unique ID.',
                        listItems: [],
                        buttons: [{ text: 'OK', onPress: () => setAlertConfig(prev => ({ ...prev, visible: false })) }],
                        icon: 'alert-circle',
                        iconColor: '#EF4444'
                    });
                    setIsSubmitting(false);
                    return;
                }
            }

            // Guard: the record may have synced while it was being edited.
            // Synced records are immutable — refuse to overwrite.
            if (isEditingDraft && formData.participantId) {
                const current = await getParticipantById(formData.participantId);
                if (current?.status === 'synced') {
                    Alert.alert(
                        'Record already synced',
                        'This record was uploaded to the server while you were editing and can no longer be changed.'
                    );
                    setIsSubmitting(false);
                    return;
                }
            }

            // Pack GPS into address field (no schema migration)
            const gpsTag = formData.gpsLatitude && formData.gpsLongitude
                ? `[GPS:${formData.gpsLatitude},${formData.gpsLongitude}]`
                : '';
            const addressForDb = [formData.address, gpsTag].filter(Boolean).join('\n') || null;
            const collectorName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : '';

            // Save current form data as draft (no validation required)
            await saveParticipant({
                participant_id: formData.participantId || '',
                mobile_number: formData.mobileNumber || '',
                full_name: formData.participantId || '',
                age: parseInt(formData.age) || 0,
                gender: formData.gender || '',
                address: addressForDb,
                date_of_screening: formData.dateOfScreening || todayDDMMYYYY(),
                region: profile?.region || '',
                district: profile?.district || '',
                facility: profile?.facility || '',
                community: formData.community || null,
                data_collector_name: collectorName,
                created_by: username || null,
                // Drafts must survive the save/load round trip without inventing
                // answers: unanswered (null) is stored as -1, which the draft
                // loader reads back as unanswered (it only maps 1/0 to Yes/No).
                // The columns are NOT NULL, so null itself cannot be stored.
                consent_obtained: formData.consentObtained === null ? -1 : formData.consentObtained ? 1 : 0,
                diabetes_status: formData.diabetesStatus || '',
                hiv_status: formData.hivStatus || '',
                covid_status: formData.covidStatus || '',
                tobacco_use: formData.tobaccoUse === null ? -1 : formData.tobaccoUse ? 1 : 0,
                tobacco_duration: formData.tobaccoDuration || null,
                alcohol_use: formData.alcoholUse === null ? -1 : formData.alcoholUse === 'Yes' || formData.alcoholUse === 'Occasional' ? 1 : 0,
                alcohol_use_frequency: formData.alcoholUse || null,
                alcohol_duration: formData.alcoholDuration || null,
                previous_tb: formData.previousTb === null ? -1 : formData.previousTb ? 1 : 0,
                last_tb_year: formData.tbYear || null,
                tb_treatment_completed: formData.tbTreatmentStatus || null,
                recurring_tb: formData.recurringTb === null ? null : formData.recurringTb ? 1 : 0,
                symptoms: JSON.stringify(formData.symptoms || {}),
                test_done: null,
                test_type: null,
                test_date_collection: null,
                test_date_result: null,
                test_result: null,
                test_site: null,
                test_notes: null,
                status: 'draft', // Save as draft
                analysis_result: null
            });

            // Save any recordings that exist (even if incomplete)
            const database = await getDB();
            try {
                // Delete existing recordings for this participant
                await database.runAsync(
                    `DELETE FROM recordings WHERE participant_id = ?`,
                    [formData.participantId]
                );
            } catch (error) {
                console.warn('Error deleting existing recordings:', error);
            }

            // Save recordings that exist
            const recordings = [
                { key: 'recording1', type: 'cough_1' },
                { key: 'recording2', type: 'cough_2' },
                { key: 'recording3', type: 'cough_3' },
                { key: 'recordingBackground', type: 'background' }
            ];

            for (const rec of recordings) {
                const uri = formData[rec.key as keyof typeof formData] as string;
                if (uri) {
                    await saveRecording({
                        participant_id: formData.participantId,
                        file_path: uri,
                        recording_type: rec.type,
                        duration: recordedDurations[rec.key] || 0
                    });
                }
            }

            console.log('Draft saved successfully!');

            // Show success message
            setSuccessMessage('Draft saved successfully!');
            if (Platform.OS === 'web') {
                setShowSuccessModal(true);
            } else {
                Alert.alert("Draft Saved", "Your draft has been saved. You can continue editing later.", [
                    { text: "OK", onPress: () => navigation.navigate('Dashboard') }
                ]);
            }
        } catch (error) {
            console.error('Error saving draft:', error);
            if (Platform.OS === 'web') {
                alert('Error saving draft. Please try again.');
            } else {
                Alert.alert("Error", "Failed to save draft. Please try again.");
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = async () => {
        console.log('Submit button clicked');
        console.log('Form data:', formData);
        console.log('Recorded durations:', recordedDurations);

        // Validate form with recorded durations
        const errors = validateForm(formData, recordedDurations);
        console.log('Validation errors:', errors);

        // Transform errors to Record<string, string> for inline display
        const errorRecord: Record<string, string> = {};
        errors.forEach(err => {
            errorRecord[err.field] = err.message;
        });
        setInlineErrors(errorRecord);

        if (errors.length > 0) {
            const errorMessage = formatValidationErrors(errors);
            console.log('Showing validation error alert:', errorMessage);

            // Auto-expand first error section and scroll to it
            const firstErrorSection = errors[0]?.section;
            if (firstErrorSection) {
                if (firstErrorSection === expandedSection) {
                    // Already expanded: layout is current, scroll directly
                    const y = sectionLayouts[firstErrorSection];
                    if (y !== undefined && scrollViewRef.current) {
                        scrollViewRef.current.scrollTo({ y: Math.max(0, y - 8), animated: true });
                    }
                } else {
                    // Expanding shifts the layout; scroll from onLayout once
                    // the section's final position is known
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setExpandedSection(firstErrorSection);
                    pendingScrollSection.current = firstErrorSection;
                }
            }

            // Show Custom Alert
            const errorList = errors.map(e => e.message);
            setAlertConfig({
                visible: true,
                title: 'Missing Required Fields',
                message: `Please complete ${errors.length} required field(s):`,
                listItems: errorList,
                buttons: [{
                    text: 'OK',
                    onPress: () => setAlertConfig(prev => ({ ...prev, visible: false }))
                }],
                icon: 'alert-circle',
                iconColor: '#EF4444'
            });
            return;
        }

        setIsSubmitting(true);
        try {
            console.log('Starting submission...');
            // Aggregate results
            const keys = ['recording1', 'recording2', 'recording3'];
            let maxConfidence = 0;
            let primaryResult = null;

            for (const key of keys) {
                const res = analysisResults[key]?.result;
                if (res) {
                    const confidence = res.confidence ?? 0;
                    if (confidence > maxConfidence) {
                        maxConfidence = confidence;
                        primaryResult = res;
                    }
                }
            }

            // Fallback if no result found (shouldn't happen if validation passes and analysis runs)
            if (!primaryResult && analysisResults['recording1']?.result) {
                primaryResult = analysisResults['recording1'].result;
            }

            // Check for existing participant with same ID (skip when editing a draft)
            if (formData.participantId && !isEditingDraft) {
                const existing = await getParticipantById(formData.participantId);
                if (existing) {
                    setAlertConfig({
                        visible: true,
                        title: 'Error',
                        message: 'Participant ID already exists. Please use a unique ID.',
                        listItems: [],
                        buttons: [{ text: 'OK', onPress: () => setAlertConfig(prev => ({ ...prev, visible: false })) }],
                        icon: 'alert-circle',
                        iconColor: '#EF4444'
                    });
                    setIsSubmitting(false);
                    return;
                }
            }

            // Guard: the record may have synced while it was being edited.
            // Synced records are immutable — refuse to overwrite.
            if (isEditingDraft && formData.participantId) {
                const current = await getParticipantById(formData.participantId);
                if (current?.status === 'synced') {
                    Alert.alert(
                        'Record already synced',
                        'This record was uploaded to the server while you were editing and can no longer be changed.'
                    );
                    setIsSubmitting(false);
                    return;
                }
            }

            // Pack GPS into address field (no schema migration)
            const submitGpsTag = formData.gpsLatitude && formData.gpsLongitude
                ? `[GPS:${formData.gpsLatitude},${formData.gpsLongitude}]`
                : '';
            const submitAddressForDb = [formData.address, submitGpsTag].filter(Boolean).join('\n') || null;
            const submitCollectorName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : '';

            // Save to DB - Ensure all fields are properly stored (null for missing, not undefined)
            console.log('Saving participant to database...');
            await saveParticipant({
                participant_id: formData.participantId || '',
                mobile_number: formData.mobileNumber || '',
                full_name: formData.participantId || '',
                age: parseInt(formData.age) || 0,
                gender: formData.gender || '',
                address: submitAddressForDb,
                date_of_screening: formData.dateOfScreening || todayDDMMYYYY(),
                region: profile?.region || '',
                district: profile?.district || '',
                facility: profile?.facility || '',
                community: formData.community || null,
                data_collector_name: submitCollectorName,
                created_by: username || null,
                consent_obtained: formData.consentObtained ? 1 : 0,
                diabetes_status: formData.diabetesStatus || '',
                hiv_status: formData.hivStatus || '',
                covid_status: formData.covidStatus || '',
                tobacco_use: formData.tobaccoUse ? 1 : 0,
                tobacco_duration: formData.tobaccoDuration || null,
                alcohol_use: formData.alcoholUse === 'Yes' || formData.alcoholUse === 'Occasional' ? 1 : 0,
                alcohol_use_frequency: formData.alcoholUse || null,
                alcohol_duration: formData.alcoholDuration || null,
                previous_tb: formData.previousTb ? 1 : 0,
                last_tb_year: formData.tbYear || null,
                tb_treatment_completed: formData.tbTreatmentStatus || null,
                recurring_tb: formData.recurringTb === null ? null : formData.recurringTb ? 1 : 0,
                symptoms: JSON.stringify(formData.symptoms || {}),
                test_done: null,
                test_type: null,
                test_date_collection: null,
                test_date_result: null,
                test_result: null,
                test_site: null,
                test_notes: null,
                status: 'pending', // Ready for sync
                analysis_result: primaryResult ? JSON.stringify(primaryResult) : null,
                // Section E fields
                test_done: formData.testResult ? (formData.testResult === 'Pending' ? 'Not yet' : 'Yes') : null, // Map to existing schema if possible, or store as JSON? 
                // Wait, schema has test_done, test_type, test_date_collection, test_date_result, test_result, test_site, test_notes
                // Let's map correctly based on DatabaseService schema
                test_type: formData.testType || null,
                test_date_collection: formData.testDateCollection || null,
                test_date_result: formData.testDateResult || null,
                test_result: formData.testResult || null,
                test_site: formData.testSite || null,
                test_notes: formData.testNotes || null
            });

            // Save Recordings - Delete existing recordings for this participant first to prevent duplicates
            // Then save new ones
            const recordings = [
                { key: 'recording1', type: 'cough_1' },
                { key: 'recording2', type: 'cough_2' },
                { key: 'recording3', type: 'cough_3' },
                { key: 'recordingBackground', type: 'background' }
            ];

            console.log('Saving recordings...');

            // Delete existing recordings for this participant to prevent duplicates
            const database = await getDB();
            try {
                await database.runAsync(
                    `DELETE FROM recordings WHERE participant_id = ?`,
                    [formData.participantId]
                );
            } catch (error) {
                console.warn('Error deleting existing recordings:', error);
            }

            // Save new recordings
            for (const rec of recordings) {
                const uri = formData[rec.key as keyof typeof formData] as string;
                if (uri) {
                    console.log(`Saving ${rec.type}:`, uri);
                    await saveRecording({
                        participant_id: formData.participantId,
                        file_path: uri,
                        recording_type: rec.type,
                        duration: recordedDurations[rec.key] || 0
                    });
                }
            }

            console.log('Submission successful!');

            // Use Modal for web, Alert for native
            setSuccessMessage('Participant saved successfully!');
            if (Platform.OS === 'web') {
                setShowSuccessModal(true);
            } else {
                Alert.alert("Success", "Participant saved successfully!", [
                    {
                        text: "OK",
                        onPress: () => {
                            // Navigate back to Dashboard
                            navigation.navigate('Dashboard' as never);
                        }
                    }
                ]);
            }

        } catch (error) {
            console.error("Submission failed:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            setAlertConfig({
                visible: true,
                title: 'Error',
                message: `Could not submit case. ${errorMessage}\n\nPlease check the console for more details.`,
                listItems: [],
                buttons: [{ text: "OK", onPress: () => setAlertConfig(prev => ({ ...prev, visible: false })) }],
                icon: 'alert-circle',
                iconColor: '#EF4444'
            });
        } finally {
            setIsSubmitting(false);
        }
    };


    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor="#2563EB" />

            {/* App Bar */}
            <View style={styles.appBar}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="white" />
                </TouchableOpacity>
                <View>
                    <Text style={styles.appBarTitle}>
                        {isEditingDraft ? (editingStatus === 'pending' ? 'Edit Record' : 'Edit Draft') : 'New Participant'}
                    </Text>
                    {profile ? (
                        <Text style={styles.appBarSubtitle} numberOfLines={1}>
                            {profile.first_name} {profile.last_name} · {profile.facility}
                        </Text>
                    ) : (
                        <Text style={styles.appBarSubtitle}>{isEditingDraft ? 'Continue editing your draft' : 'Complete all sections'}</Text>
                    )}
                </View>
            </View>

            {isLoadingDraft ? (
                <View style={styles.draftLoadingContainer}>
                    <ActivityIndicator size="large" color="#2563EB" />
                    <Text style={styles.draftLoadingText}>Loading draft...</Text>
                </View>
            ) : (<>

            <ScrollView
                style={styles.content}
                contentContainerStyle={{ paddingBottom: 100 + insets.bottom * 2 }}
                ref={scrollViewRef}
            >
                {/* Section A */}
                <AccordionSection
                    title="A. Individual & Location Details"
                    section="A"
                    isExpanded={expandedSection === 'A'}
                    onToggle={() => toggleSection('A')}
                    onLayout={(e) => onSectionLayout('A', e)}
                >
                    <SectionA
                        formData={formData}
                        updateField={handleUpdateField}
                        expandedDropdown={expandedDropdown}
                        setExpandedDropdown={setExpandedDropdown}
                        errors={inlineErrors}
                    />
                </AccordionSection>

                {/* Section B: Comorbidities & Vulnerability */}
                <AccordionSection
                    title="B. Comorbidities & Vulnerability"
                    section="B"
                    isExpanded={expandedSection === 'B'}
                    onToggle={() => toggleSection('B')}
                    disabled={formData.consentObtained !== true}
                    onLayout={(e) => onSectionLayout('B', e)}
                >
                    <SectionB
                        formData={formData}
                        updateField={handleUpdateField}
                        expandedDropdown={expandedDropdown}
                        setExpandedDropdown={setExpandedDropdown}
                        errors={inlineErrors}
                    />
                </AccordionSection>

                {/* Section C: Symptoms */}
                <AccordionSection
                    title="C. Symptoms"
                    section="C"
                    isExpanded={expandedSection === 'C'}
                    onToggle={() => toggleSection('C')}
                    disabled={formData.consentObtained !== true}
                    onLayout={(e) => onSectionLayout('C', e)}
                >
                    <SectionC
                        formData={formData}
                        updateSymptom={handleUpdateSymptom}
                        errors={inlineErrors}
                    />
                </AccordionSection>

                {/* Section D: Cough & Audio Recording */}
                <AccordionSection
                    title="D. Cough & Audio Recording"
                    section="D"
                    isExpanded={expandedSection === 'D'}
                    onToggle={() => toggleSection('D')}
                    disabled={formData.consentObtained !== true}
                    onLayout={(e) => onSectionLayout('D', e)}
                >
                    <SectionD
                        formData={formData}
                        updateField={handleUpdateField}
                        activeRecordingKey={activeRecordingKey}
                        recordingDuration={recordingDuration}
                        recordedDurations={recordedDurations}
                        analysisResults={analysisResults}
                        onStartRecording={startRecording}
                        onStopRecording={stopRecording}
                        onClearRecording={clearRecording}
                        onUseSample={handleUseSample}
                        errors={inlineErrors}
                    />
                </AccordionSection>
            </ScrollView>

            {/* Validation Error Modal for Web */}
            <Modal
                visible={showValidationModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowValidationModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Missing Required Fields</Text>
                            <TouchableOpacity
                                onPress={() => setShowValidationModal(false)}
                                style={styles.modalCloseButton}
                            >
                                <Ionicons name="close" size={24} color="#64748B" />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalScrollView}>
                            <Text style={styles.modalText}>{validationErrors}</Text>
                        </ScrollView>
                        <TouchableOpacity
                            style={styles.modalButton}
                            onPress={() => {
                                setShowValidationModal(false);
                                console.log('User acknowledged validation errors');
                            }}
                        >
                            <Text style={styles.modalButtonText}>OK</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Success Modal for Web */}
            <Modal
                visible={showSuccessModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => {
                    setShowSuccessModal(false);
                    navigation.navigate('Dashboard' as never);
                }}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name="checkmark-circle" size={24} color="#22C55E" style={{ marginRight: 12 }} />
                                <Text style={styles.modalTitle}>Success</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => {
                                    setShowSuccessModal(false);
                                    navigation.navigate('Dashboard');
                                }}
                                style={styles.modalCloseButton}
                            >
                                <Ionicons name="close" size={24} color="#64748B" />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.modalScrollView}>
                            <Text style={styles.modalText}>
                                {successMessage}
                            </Text>
                            <Text style={[styles.modalText, { marginTop: 12, fontSize: 12, color: '#64748B' }]}>
                                {successMessage.includes('Draft')
                                    ? 'You can continue editing this form later from the Drafts section.'
                                    : 'The participant data has been saved and will appear on the dashboard.'}
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={styles.modalButton}
                            onPress={() => {
                                setShowSuccessModal(false);
                                navigation.navigate('Dashboard');
                            }}
                        >
                            <Text style={styles.modalButtonText}>Go to Dashboard</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Footer */}
            {/* Keep a minimum clearance above the system navigation area even on
                devices that report a zero bottom inset (non-edge-to-edge phones
                with 3-button navigation), where the nav bar sits flush below the
                window and taps aimed at the footer can hit system buttons. */}
            <View style={[styles.footer, { paddingBottom: Math.max(16 + insets.bottom * 2, 48) }]}>
                <TouchableOpacity
                    style={styles.draftBtn}
                    onPress={handleSaveDraft}
                    disabled={isSubmitting}
                >
                    <Ionicons name="save-outline" size={20} color="#334155" style={{ marginRight: 8 }} />
                    <Text style={styles.draftBtnText}>Save Draft</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[
                        styles.submitBtn,
                        formData.consentObtained === true ? styles.submitBtnActive : {}
                    ]}
                    disabled={formData.consentObtained !== true || isSubmitting}
                    onPress={() => {
                        console.log('Submit button pressed');
                        console.log('Consent obtained:', formData.consentObtained);
                        console.log('Is submitting:', isSubmitting);
                        handleSubmit();
                    }}
                >
                    {isSubmitting ? (
                        <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                    ) : null}
                    <Text style={styles.submitBtnText}>
                        {isSubmitting ? "Analyzing..." : "Submit"}
                    </Text>
                </TouchableOpacity>
            </View>

            </>)}

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

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F1F5F9',
    },
    draftLoadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    draftLoadingText: {
        marginTop: 12,
        color: '#64748B',
        fontSize: 14,
    },
    appBar: {
        backgroundColor: '#2563EB',
        padding: 16,
        paddingTop: 40,
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButton: {
        marginRight: 16,
    },
    appBarTitle: {
        color: 'white',
        fontSize: 18,
        fontWeight: '600',
    },
    appBarSubtitle: {
        color: '#BFDBFE',
        fontSize: 12,
    },
    content: {
        flex: 1,
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'white',
        padding: 16,
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
        gap: 12,
    },
    draftBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#E2E8F0',
        padding: 16,
        borderRadius: 8,
    },
    draftBtnText: {
        color: '#334155',
        fontWeight: '600',
        fontSize: 16,
    },
    submitBtn: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#CBD5E1', // Disabled look for now
        padding: 16,
        borderRadius: 8,
        flexDirection: 'row',
    },
    submitBtnActive: {
        backgroundColor: '#22C55E', // Green color to match images
    },
    submitBtnText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 16,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        backgroundColor: 'white',
        borderRadius: 16,
        width: '100%',
        maxWidth: 500,
        maxHeight: '80%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#1E293B',
    },
    modalCloseButton: {
        padding: 4,
    },
    modalScrollView: {
        maxHeight: 400,
        padding: 20,
    },
    modalText: {
        fontSize: 14,
        color: '#475569',
        lineHeight: 22,
    },
    modalButton: {
        backgroundColor: '#2563EB',
        padding: 16,
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        alignItems: 'center',
    },
    modalButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default NewParticipantScreen;
