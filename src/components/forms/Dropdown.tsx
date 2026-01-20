/**
 * Reusable Dropdown component
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Modal, TouchableWithoutFeedback } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface DropdownProps {
    label: string;
    value: string | null;
    options: string[];
    onSelect: (val: string) => void;
    isExpanded: boolean;
    onToggle: () => void;
    placeholder?: string;
    error?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({
    label,
    value,
    options,
    onSelect,
    isExpanded,
    onToggle,
    placeholder = "Select",
    error
}) => {
    return (
        <View style={{ marginBottom: 16 }}>
            <Text style={styles.label}>{label}</Text>
            <TouchableOpacity
                style={[styles.dropdown, error ? { borderColor: '#EF4444', borderWidth: 1 } : {}]}
                onPress={onToggle}
            >
                <Text style={value ? styles.inputText : styles.placeholderText}>
                    {value || placeholder}
                </Text>
                <Ionicons name="chevron-down" size={20} color="#64748B" />
            </TouchableOpacity>
            {error && <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 4 }}>{error}</Text>}

            <Modal
                visible={isExpanded}
                transparent={true}
                animationType="fade"
                onRequestClose={onToggle}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={onToggle}
                >
                    <TouchableWithoutFeedback>
                        <View style={styles.modalContent}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>{label}</Text>
                                <TouchableOpacity onPress={onToggle}>
                                    <Ionicons name="close" size={24} color="#64748B" />
                                </TouchableOpacity>
                            </View>
                            <FlatList
                                data={options}
                                keyExtractor={(item) => item}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        style={styles.dropdownItem}
                                        onPress={() => {
                                            onSelect(item);
                                            onToggle();
                                        }}
                                    >
                                        <Text style={styles.dropdownItemText}>{item}</Text>
                                        {value === item && (
                                            <Ionicons name="checkmark" size={20} color="#2563EB" />
                                        )}
                                    </TouchableOpacity>
                                )}
                                style={{ maxHeight: 400 }}
                            />
                        </View>
                    </TouchableWithoutFeedback>
                </TouchableOpacity>
            </Modal>
        </View>
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
    dropdown: {
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 8,
        padding: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'white',
    },
    placeholderText: {
        color: '#94A3B8',
        fontSize: 16,
    },
    inputText: {
        color: '#1E293B',
        fontSize: 16,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        padding: 20,
    },
    modalContent: {
        backgroundColor: 'white',
        borderRadius: 12,
        maxHeight: '80%',
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#1E293B',
    },
    dropdownItem: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    dropdownItemText: {
        fontSize: 16,
        color: '#1E293B',
    },
});

