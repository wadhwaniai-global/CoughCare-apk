/**
 * Capture Diagnostic (TEST BUILDS ONLY)
 *
 * Records a fixed-length take from a chosen Android audio source so the same
 * stimulus can be captured through MIC, VOICE_RECOGNITION and UNPROCESSED on
 * one device, scored on-device, and exported as WAV for offline comparison
 * across models. Exists because the source constant does not standardize
 * the audio: vendors process each path differently (Galaxy A07, 2026-09-10).
 */

import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, StatusBar, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import { AudioRecorder, getCaptureProfile } from '../utils/audioRecorder';
import { detectCoughFromUrl } from '../utils/onnxInference';

const TAKE_SECONDS = 12;
const SOURCES: Array<{ id: 1 | 6 | 9; name: string; short: string }> = [
    { id: 1, name: 'MIC', short: 'MIC' },
    { id: 6, name: 'VOICE_RECOGNITION', short: 'VR' },
    { id: 9, name: 'UNPROCESSED', short: 'UNP' },
];

interface Take {
    key: string;
    source: string;
    seconds: number;
    probability: number | null;
    path: string;
    exported: string; // exported file name, or an error/skip note
}

const CaptureDiagnosticScreen = () => {
    const navigation = useNavigation();
    const recorderRef = useRef(new AudioRecorder());
    const [busy, setBusy] = useState<string | null>(null);
    const [countdown, setCountdown] = useState(0);
    const [exportDir, setExportDir] = useState<string | null>(null);
    const [takes, setTakes] = useState<Take[]>([]);

    const chooseExportFolder = async () => {
        try {
            const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
            if (perm.granted) setExportDir(perm.directoryUri);
        } catch (e: any) {
            Alert.alert('Export folder', e?.message || String(e));
        }
    };

    const exportWav = async (path: string, name: string): Promise<string> => {
        if (!exportDir) return 'not exported (no folder chosen)';
        try {
            const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
            const uri = await FileSystem.StorageAccessFramework.createFileAsync(exportDir, name, 'audio/wav');
            await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
            return name;
        } catch (e: any) {
            return `export failed: ${e?.message || e}`;
        }
    };

    const record = async (source: { id: 1 | 6 | 9; name: string; short: string }) => {
        if (busy) return;
        setBusy(source.name);
        try {
            await recorderRef.current.start(source.id);
            for (let left = TAKE_SECONDS; left > 0; left--) {
                setCountdown(left);
                await new Promise((r) => setTimeout(r, 1000));
            }
            setCountdown(0);
            const path = await recorderRef.current.stop();
            let probability: number | null = null;
            try {
                const res = await detectCoughFromUrl(path);
                probability = res.confidence;
            } catch (e) {
                console.warn('[CaptureDiagnostic] scoring failed', e);
            }
            const stamp = new Date();
            const hhmmss = `${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}`;
            const exported = await exportWav(path, `diag_${source.short}_${hhmmss}.wav`);
            setTakes((prev) => [{ key: `${source.short}-${stamp.getTime()}`, source: source.name, seconds: TAKE_SECONDS, probability, path, exported }, ...prev]);
        } catch (e: any) {
            Alert.alert(`${source.name} failed`, e?.message || String(e));
        } finally {
            setBusy(null);
            setCountdown(0);
        }
    };

    const profile = getCaptureProfile();

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor="#2563EB" />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="white" />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>Capture Diagnostic</Text>
                    <Text style={styles.headerSubtitle}>{profile.deviceModel} · fleet profile {profile.audioSource} @ {profile.sampleRate / 1000} kHz</Text>
                </View>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
                <Text style={styles.help}>
                    Each button records {TAKE_SECONDS} seconds from one Android audio source, scores it with the on-device model, and exports the WAV to the chosen folder. Play the same sound for every take.
                </Text>
                <TouchableOpacity style={[styles.folderBtn, exportDir && styles.folderBtnSet]} onPress={chooseExportFolder}>
                    <Ionicons name="folder-open-outline" size={18} color={exportDir ? '#166534' : '#334155'} style={{ marginRight: 8 }} />
                    <Text style={styles.folderText}>{exportDir ? 'Export folder set' : 'Choose export folder (e.g. Download)'}</Text>
                </TouchableOpacity>
                <View style={styles.row}>
                    {SOURCES.map((src) => (
                        <TouchableOpacity
                            key={src.id}
                            style={[styles.srcBtn, busy === src.name && styles.srcBtnActive, !!busy && busy !== src.name && styles.srcBtnDisabled]}
                            disabled={!!busy}
                            onPress={() => record(src)}
                        >
                            <Text style={styles.srcBtnText}>{src.name}</Text>
                            <Text style={styles.srcBtnSub}>{busy === src.name ? (countdown > 0 ? `recording ${countdown}` : 'scoring…') : `source ${src.id}`}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
                {takes.map((t) => (
                    <View key={t.key} style={styles.take}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <Text style={styles.takeSource}>{t.source}</Text>
                            <Text style={[styles.takeScore, { color: (t.probability ?? 0) > 0.4758 ? '#16A34A' : '#DC2626' }]}>
                                {t.probability === null ? 'no score' : `${(t.probability * 100).toFixed(1)}%`}
                            </Text>
                        </View>
                        <Text style={styles.takeMeta}>{t.seconds}s · {t.exported}</Text>
                        <Text style={styles.takePath} numberOfLines={1}>{t.path.split('/').pop()}</Text>
                    </View>
                ))}
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC' },
    header: { backgroundColor: '#2563EB', padding: 16, paddingTop: 40, flexDirection: 'row', alignItems: 'center' },
    backButton: { marginRight: 16 },
    headerTitle: { color: 'white', fontSize: 18, fontWeight: '600' },
    headerSubtitle: { color: '#BFDBFE', fontSize: 12, marginTop: 2 },
    help: { fontSize: 13, color: '#475569', marginBottom: 12 },
    folderBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 12, marginBottom: 12 },
    folderBtnSet: { borderColor: '#86EFAC', backgroundColor: '#F0FDF4' },
    folderText: { fontSize: 14, color: '#334155', fontWeight: '600' },
    row: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    srcBtn: { flex: 1, backgroundColor: '#2563EB', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center' },
    srcBtnActive: { backgroundColor: '#DC2626' },
    srcBtnDisabled: { opacity: 0.4 },
    srcBtnText: { color: 'white', fontWeight: '700', fontSize: 11 },
    srcBtnSub: { color: '#DBEAFE', fontSize: 10, marginTop: 4 },
    take: { backgroundColor: 'white', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
    takeSource: { fontWeight: '700', color: '#1E293B' },
    takeScore: { fontWeight: '700' },
    takeMeta: { fontSize: 12, color: '#64748B', marginTop: 4 },
    takePath: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
});

export default CaptureDiagnosticScreen;
