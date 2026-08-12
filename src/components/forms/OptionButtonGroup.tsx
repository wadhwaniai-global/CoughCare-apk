/**
 * Reusable Option Button Group component
 *
 * String-valued sibling of RadioButtonGroup, for questions with more than the
 * fixed Yes/No pair. Styling is kept identical so the two controls look the same.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface OptionButtonGroupProps {
    label?: string;
    value: string | null;
    options: string[];
    onSelect: (val: string) => void;
    /** Relative width per option, matched by index. Defaults to equal widths. */
    weights?: number[];
}

export const OptionButtonGroup: React.FC<OptionButtonGroupProps> = ({
    label,
    value,
    options,
    onSelect,
    weights,
}) => {
    const getButtonStyle = (selected: boolean) => {
        if (selected) {
            return [styles.radioButton, styles.radioButtonActive];
        }
        return styles.radioButton;
    };

    const getTextStyle = (selected: boolean) => {
        if (selected) {
            return [styles.radioText, styles.radioTextActive];
        }
        return styles.radioText;
    };

    return (
        <View style={{ marginBottom: 16, width: '100%' }}>
            {label && <Text style={styles.label}>{label}</Text>}
            <View style={styles.radioGroup}>
                {options.map((option, index) => (
                    <TouchableOpacity
                        key={option}
                        style={[getButtonStyle(value === option), { flex: weights?.[index] ?? 1 }]}
                        onPress={() => onSelect(option)}
                    >
                        <Text
                            style={getTextStyle(value === option)}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.8}
                        >
                            {option}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
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
    radioGroup: {
        flexDirection: 'row',
    },
    radioButton: {
        flex: 1,
        backgroundColor: '#F8FAFC',
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#CBD5E1',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        marginHorizontal: 4,
    },
    radioButtonActive: {
        borderColor: '#2563EB',
        backgroundColor: '#EFF6FF',
        borderWidth: 2,
    },
    radioText: {
        color: '#000000',
        fontWeight: 'bold',
        fontSize: 16,
    },
    radioTextActive: {
        color: '#2563EB',
        fontWeight: 'bold',
    },
});
