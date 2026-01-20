import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface CustomAlertProps {
    visible: boolean;
    title: string;
    message?: string;
    listItems?: string[];
    onClose: () => void;
    buttons?: {
        text: string;
        onPress: () => void;
        style?: 'default' | 'cancel' | 'destructive';
    }[];
    icon?: keyof typeof Ionicons.glyphMap;
    iconColor?: string;
}

export const CustomAlert: React.FC<CustomAlertProps> = ({
    visible,
    title,
    message,
    listItems,
    onClose,
    buttons,
    icon = 'alert-circle',
    iconColor = '#EF4444'
}) => {
    const defaultButtons = [
        {
            text: 'OK',
            onPress: onClose,
            style: 'default' as const
        }
    ];

    const actionButtons = buttons && buttons.length > 0 ? buttons : defaultButtons;

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.alertContainer}>
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.titleContainer}>
                            <Ionicons name={icon} size={24} color="white" style={{ marginRight: 10 }} />
                            <Text style={styles.title}>{title}</Text>
                        </View>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={24} color="white" />
                        </TouchableOpacity>
                    </View>

                    {/* Content */}
                    <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
                        {message && <Text style={styles.message}>{message}</Text>}

                        {listItems && listItems.length > 0 && (
                            <View style={styles.listContainer}>
                                {listItems.map((item, index) => (
                                    <View key={index} style={styles.listItem}>
                                        <Text style={styles.bulletPoint}>•</Text>
                                        <Text style={styles.listItemText}>{item}</Text>
                                    </View>
                                ))}
                            </View>
                        )}
                    </ScrollView>

                    {/* Footer / Buttons */}
                    <View style={styles.footer}>
                        {actionButtons.map((btn, index) => (
                            <TouchableOpacity
                                key={index}
                                style={[
                                    styles.button,
                                    btn.style === 'cancel' ? styles.cancelButton :
                                        btn.style === 'destructive' ? styles.destructiveButton :
                                            styles.defaultButton,
                                    index > 0 && { marginLeft: 10 }
                                ]}
                                onPress={btn.onPress}
                            >
                                <Text style={[
                                    styles.buttonText,
                                    btn.style === 'cancel' ? styles.cancelButtonText :
                                        btn.style === 'destructive' ? styles.destructiveButtonText :
                                            styles.defaultButtonText
                                ]}>
                                    {btn.text}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    alertContainer: {
        width: '100%',
        maxWidth: 400,
        maxHeight: height * 0.8,
        backgroundColor: 'white',
        borderRadius: 16,
        overflow: 'hidden',
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    header: {
        backgroundColor: '#2563EB',
        padding: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    title: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    closeButton: {
        padding: 4,
    },
    content: {
        maxHeight: height * 0.5,
    },
    contentContainer: {
        padding: 20,
    },
    message: {
        fontSize: 16,
        color: '#334155',
        marginBottom: 12,
        lineHeight: 22,
    },
    listContainer: {
        marginTop: 8,
    },
    listItem: {
        flexDirection: 'row',
        marginBottom: 8,
        alignItems: 'flex-start',
    },
    bulletPoint: {
        fontSize: 16,
        color: '#2563EB',
        marginRight: 8,
        lineHeight: 22,
    },
    listItemText: {
        fontSize: 15,
        color: '#475569',
        flex: 1,
        lineHeight: 22,
    },
    footer: {
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
        flexDirection: 'row',
        justifyContent: 'flex-end',
        backgroundColor: '#F8FAFC',
    },
    button: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 8,
        minWidth: 80,
        alignItems: 'center',
    },
    defaultButton: {
        backgroundColor: '#2563EB',
    },
    cancelButton: {
        backgroundColor: 'white',
        borderWidth: 1,
        borderColor: '#CBD5E1',
    },
    destructiveButton: {
        backgroundColor: '#EF4444',
    },
    buttonText: {
        fontWeight: '600',
        fontSize: 14,
    },
    defaultButtonText: {
        color: 'white',
    },
    cancelButtonText: {
        color: '#64748B',
    },
    destructiveButtonText: {
        color: 'white',
    },
});
