import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Platform, ToastAndroid, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Dropdown } from '../forms/Dropdown';
import { RadioButtonGroup } from '../forms/RadioButtonGroup';
import { ParticipantFormData } from '../../types/participantForm';
import {} from '../../utils/dateUtils';


interface SectionAProps {
    formData: ParticipantFormData;
    updateField: <K extends keyof ParticipantFormData>(field: K, value: ParticipantFormData[K]) => void;
    expandedDropdown: string | null;
    setExpandedDropdown: (key: string | null) => void;
    errors?: Record<string, string>;
}

export const SectionA: React.FC<SectionAProps> = ({
    formData,
    updateField,
    expandedDropdown,
    setExpandedDropdown,
    errors = {},
}) => {
    const [isCapturingGps, setIsCapturingGps] = useState(false);

    const handleCaptureGps = async () => {
        try {
            setIsCapturingGps(true);
            const Location = await import('expo-location');
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                showToast('Location permission denied');
                return;
            }
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            updateField('gpsLatitude', pos.coords.latitude.toFixed(6));
            updateField('gpsLongitude', pos.coords.longitude.toFixed(6));
        } catch (e) {
            console.error('[SectionA] GPS capture failed:', e);
            showToast('Failed to capture GPS location');
        } finally {
            setIsCapturingGps(false);
        }
    };

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

    const handleAlphanumericChange = (field: keyof ParticipantFormData, text: string, maxLength: number = 1000) => {
        // Allow letters, numbers, and spaces (no newlines)
        const validText = text.replace(/[^a-zA-Z0-9 ]/g, '');

        if (text !== validText) {
            showToast('Only alphanumeric characters are allowed');
        }

        if (validText.length >= maxLength) {
            showToast(`Maximum character limit (${maxLength}) reached`);
            updateField(field, validText.slice(0, maxLength));
        } else {
            updateField(field, validText);
        }
    };

    const handleNumericChange = (field: keyof ParticipantFormData, text: string, maxLength: number = 1000) => {
        const validText = text.replace(/[^0-9]/g, '');
        if (text !== validText) {
            showToast('Only numeric characters are allowed');
        }
        if (validText.length >= maxLength) {
            showToast(`Maximum character limit (${maxLength}) reached`);
            updateField(field, validText.slice(0, maxLength));
        } else {
            updateField(field, validText);
        }
    };

    return (
        <>
            <Text style={styles.label}>Participant ID *</Text>
            <View style={[styles.input, styles.readOnlyInput]}>
                <Text style={styles.readOnlyText}>
                    {formData.participantId || 'Generating…'}
                </Text>
            </View>
            {errors['participantId'] && <Text style={styles.errorText}>{errors['participantId']}</Text>}

            {/* Screening date is set by the app (today when the record is created,
                the stored date when editing) and is deliberately not editable by
                the collector: it is a fact about the encounter, not a form input. */}
            <Text style={styles.label}>Date of Screening *</Text>
            <View style={[styles.input, styles.readOnlyInput]}>
                <Text style={styles.readOnlyText}>{formData.dateOfScreening}</Text>
            </View>
            {errors['dateOfScreening'] && <Text style={styles.errorText}>{errors['dateOfScreening']}</Text>}

            <Text style={styles.label}>Mobile Number *</Text>
            <TextInput
                style={[styles.input, errors['mobileNumber'] && styles.inputError]}
                placeholder="0XX XXX XXXX"
                keyboardType="phone-pad"
                maxLength={10}
                value={formData.mobileNumber}
                onChangeText={(text) => {
                    // Only allow digits, max 10
                    const digitsOnly = text.replace(/\D/g, '').slice(0, 10);
                    if (text.length > 10) {
                        showToast('Mobile number cannot exceed 10 digits');
                    }
                    updateField('mobileNumber', digitsOnly);
                }}
                multiline={false}
            />
            {errors['mobileNumber'] && <Text style={styles.errorText}>{errors['mobileNumber']}</Text>}



            <View style={styles.row}>
                <View style={[styles.col, { marginRight: 8 }]}>
                    <Text style={styles.label}>Age *</Text>
                    <TextInput
                        style={[styles.input, errors['age'] && styles.inputError]}
                        placeholder="Years"
                        keyboardType="numeric"
                        maxLength={3}
                        value={formData.age}
                        onChangeText={(text) => {
                            // Only allow digits
                            const digitsOnly = text.replace(/\D/g, '');
                            if (digitsOnly === '') {
                                updateField('age', '');
                                return;
                            }

                            const num = parseInt(digitsOnly, 10);

                            if (num === 0) {
                                showToast('Age cannot be 0');
                                // Don't update or reset to empty? Let's reset to empty to force re-entry
                                updateField('age', '');
                                return;
                            }

                            if (num > 125) {
                                showToast('Age cannot be more than 125');
                                updateField('age', '');
                            } else {
                                updateField('age', digitsOnly);
                            }
                        }}
                        multiline={false}
                    />
                    {errors['age'] && <Text style={styles.errorText}>{errors['age']}</Text>}
                </View>
                <View style={[styles.col, { marginLeft: 8 }]}>
                    <Dropdown
                        label="Gender *"
                        value={formData.gender}
                        options={['Male', 'Female', 'Transgender']}
                        onSelect={(val) => updateField('gender', val)}
                        isExpanded={expandedDropdown === 'gender'}
                        onToggle={() => setExpandedDropdown(expandedDropdown === 'gender' ? null : 'gender')}
                    />
                    {errors['gender'] && <Text style={styles.errorText}>{errors['gender']}</Text>}
                </View>
            </View>

            <Text style={styles.label}>Address (Optional)</Text>
            <TextInput
                style={[styles.input, { height: 80, textAlignVertical: 'top', maxHeight: 100 }]}
                placeholder="Enter address"
                multiline
                numberOfLines={3}
                maxLength={1000}
                value={formData.address}
                onChangeText={(text) => handleTextChange('address', text)}
            />

            <Text style={styles.label}>Community Name (Optional)</Text>
            <TextInput
                style={styles.input}
                placeholder="Enter community"
                value={formData.community}
                maxLength={1000}
                onChangeText={(text) => handleTextChange('community', text)}
                multiline={false}
            />

            <Text style={styles.label}>GPS Coordinates *</Text>
            <View style={styles.gpsRow}>
                <View style={[styles.gpsReadout, errors['gpsCoordinates'] && styles.inputError]}>
                    <Ionicons name="location-outline" size={18} color="#64748B" style={{ marginRight: 6 }} />
                    <Text style={styles.gpsText} numberOfLines={1}>
                        {formData.gpsLatitude && formData.gpsLongitude
                            ? `${formData.gpsLatitude}, ${formData.gpsLongitude}`
                            : 'Not captured'}
                    </Text>
                </View>
                <TouchableOpacity onPress={handleCaptureGps} style={styles.gpsButton} disabled={isCapturingGps}>
                    <Ionicons name="locate" size={16} color="white" style={{ marginRight: 4 }} />
                    <Text style={styles.gpsButtonText}>
                        {isCapturingGps ? 'Capturing…' : formData.gpsLatitude ? 'Re-capture' : 'Capture'}
                    </Text>
                </TouchableOpacity>
            </View>
            {errors['gpsCoordinates'] && <Text style={styles.errorText}>{errors['gpsCoordinates']}</Text>}

            <View style={[styles.consentContainer, (formData.consentObtained === false || errors['consentObtained']) && styles.consentContainerError]}>
                <Text style={styles.label}>Consent Obtained *</Text>
                <RadioButtonGroup
                    value={formData.consentObtained}
                    onSelect={(val) => updateField('consentObtained', val)}
                    variant={formData.consentObtained === true ? 'success' : formData.consentObtained === false ? 'error' : 'default'}
                />
                {errors['consentObtained'] && <Text style={styles.errorText}>{errors['consentObtained']}</Text>}
            </View>

            {formData.consentObtained === false && (
                <View style={styles.errorBox}>
                    <Ionicons name="warning" size={20} color="#F59E0B" style={{ marginRight: 8 }} />
                    <Text style={styles.errorText}>Cannot proceed without consent. Please obtain consent to continue.</Text>
                </View>
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
    inputError: {
        borderColor: '#EF4444',
        borderWidth: 1,
    },
    readOnlyInput: {
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
    },
    readOnlyText: {
        color: '#64748B',
        fontWeight: '600',
    },
    gpsRow: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
    },
    gpsReadout: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 12,
        backgroundColor: '#F8FAFC',
        flexDirection: 'row',
        alignItems: 'center',
    },
    gpsText: {
        color: '#1E293B',
        fontSize: 14,
        flex: 1,
    },
    gpsButton: {
        backgroundColor: '#0B8280',
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    gpsButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },
    row: {
        flexDirection: 'row',
    },
    col: {
        flex: 1,
    },
    consentContainer: {
        marginTop: 16,
        backgroundColor: '#E0F2F1',
        padding: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#B2DFDB',
    },
    consentContainerError: {
        borderColor: '#EF4444',
        backgroundColor: '#FEF2F2',
    },
    radioGroup: {
        flexDirection: 'row',
        gap: 16,
    },
    errorBox: {
        flexDirection: 'row',
        backgroundColor: '#FEF2F2',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#FECACA',
        marginTop: 16,
        alignItems: 'center',
    },
    errorText: {
        color: '#EF4444',
        fontSize: 12,
        marginTop: 4,
    },
});
