/**
 * Audio playback for verifying a recorded file (expo-av).
 *
 * Default variant: a compact inline player — play/pause, a live progress bar
 * (tap to seek), and elapsed/total time. Used on the recording cards.
 * `compact`: icon-only play/stop button for tight list rows (ViewRecord).
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, AVPlaybackStatus } from 'expo-av';

interface AudioPlayButtonProps {
    uri: string;
    /** Known clip length in seconds, shown before the file is loaded */
    durationSeconds?: number;
    compact?: boolean;
}

const fmt = (millis: number): string => {
    const total = Math.max(0, Math.round(millis / 1000));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const AudioPlayButton: React.FC<AudioPlayButtonProps> = ({ uri, durationSeconds, compact = false }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [positionMillis, setPositionMillis] = useState(0);
    const [durationMillis, setDurationMillis] = useState((durationSeconds ?? 0) * 1000);
    const soundRef = useRef<Audio.Sound | null>(null);
    const trackWidthRef = useRef(1);

    const unload = async () => {
        const sound = soundRef.current;
        soundRef.current = null;
        if (sound) {
            try {
                await sound.unloadAsync();
            } catch {
                // already unloaded
            }
        }
    };

    // Stop and release when the file changes (re-record) or on unmount
    useEffect(() => {
        setIsPlaying(false);
        setPositionMillis(0);
        setDurationMillis((durationSeconds ?? 0) * 1000);
        return () => {
            unload();
        };
    }, [uri]);

    const onStatus = (status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;
        setPositionMillis(status.positionMillis ?? 0);
        if (status.durationMillis) setDurationMillis(status.durationMillis);
        if (status.didJustFinish) {
            setIsPlaying(false);
            setPositionMillis(0);
            soundRef.current?.setPositionAsync(0).catch(() => {});
        }
    };

    const ensureLoaded = async (): Promise<Audio.Sound | null> => {
        if (soundRef.current) return soundRef.current;
        setIsLoading(true);
        try {
            const { sound } = await Audio.Sound.createAsync(
                { uri },
                { shouldPlay: false, progressUpdateIntervalMillis: 250 },
                onStatus
            );
            soundRef.current = sound;
            return sound;
        } catch (error) {
            console.warn('[AudioPlayButton] Load failed:', error);
            return null;
        } finally {
            setIsLoading(false);
        }
    };

    const toggle = async () => {
        if (isLoading) return;
        try {
            const sound = await ensureLoaded();
            if (!sound) return;
            if (isPlaying) {
                await sound.pauseAsync();
                setIsPlaying(false);
            } else {
                await sound.playAsync();
                setIsPlaying(true);
            }
        } catch (error) {
            console.warn('[AudioPlayButton] Playback failed:', error);
            setIsPlaying(false);
        }
    };

    const seek = async (locationX: number) => {
        if (!durationMillis) return;
        const sound = await ensureLoaded();
        if (!sound) return;
        const ratio = Math.min(Math.max(locationX / trackWidthRef.current, 0), 1);
        const target = Math.round(ratio * durationMillis);
        setPositionMillis(target);
        try {
            await sound.setPositionAsync(target);
        } catch {
            // sound was released mid-seek
        }
    };

    if (compact) {
        const compactToggle = async () => {
            // Compact rows keep the old semantics: play from start / stop
            if (isPlaying) {
                setIsPlaying(false);
                await unload();
                return;
            }
            const sound = await ensureLoaded();
            if (!sound) return;
            await sound.setPositionAsync(0);
            await sound.playAsync();
            setIsPlaying(true);
        };
        return (
            <TouchableOpacity style={styles.compactBtn} onPress={compactToggle} disabled={isLoading}>
                {isLoading ? (
                    <ActivityIndicator size="small" color="#2563EB" />
                ) : (
                    <Ionicons name={isPlaying ? 'stop' : 'play'} size={18} color="#2563EB" />
                )}
            </TouchableOpacity>
        );
    }

    const progress = durationMillis > 0 ? Math.min(positionMillis / durationMillis, 1) : 0;

    return (
        <View style={styles.player}>
            <TouchableOpacity style={styles.playCircle} onPress={toggle} disabled={isLoading}>
                {isLoading ? (
                    <ActivityIndicator size="small" color="white" />
                ) : (
                    <Ionicons
                        name={isPlaying ? 'pause' : 'play'}
                        size={18}
                        color="white"
                        style={isPlaying ? undefined : { marginLeft: 2 }}
                    />
                )}
            </TouchableOpacity>
            <Pressable
                style={styles.trackHitArea}
                onLayout={(e) => { trackWidthRef.current = Math.max(e.nativeEvent.layout.width, 1); }}
                onPress={(e) => seek(e.nativeEvent.locationX)}
            >
                <View style={styles.track}>
                    <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
                </View>
            </Pressable>
            <Text style={styles.time}>
                {fmt(positionMillis)} / {fmt(durationMillis)}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    player: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 10,
    },
    playCircle: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#2563EB',
        alignItems: 'center',
        justifyContent: 'center',
    },
    trackHitArea: {
        flex: 1,
        paddingVertical: 10, // generous touch target for seeking
        marginHorizontal: 10,
    },
    track: {
        height: 5,
        borderRadius: 3,
        backgroundColor: '#BFDBFE',
        overflow: 'hidden',
    },
    trackFill: {
        height: '100%',
        borderRadius: 3,
        backgroundColor: '#2563EB',
    },
    time: {
        fontSize: 12,
        color: '#1E3A8A',
        fontVariant: ['tabular-nums'],
        minWidth: 78,
        textAlign: 'right',
    },
    compactBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 10,
    },
});
