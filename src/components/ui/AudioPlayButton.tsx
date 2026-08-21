/**
 * Play/stop button for verifying a recorded audio file (expo-av playback).
 * `compact` renders an icon-only button for list rows; the default renders a
 * labeled pill for use next to Re-record in the recording cards.
 */

import React, { useEffect, useRef, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';

interface AudioPlayButtonProps {
    uri: string;
    compact?: boolean;
}

export const AudioPlayButton: React.FC<AudioPlayButtonProps> = ({ uri, compact = false }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const soundRef = useRef<Audio.Sound | null>(null);

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
        return () => {
            unload();
        };
    }, [uri]);

    const toggle = async () => {
        if (isLoading) return;
        try {
            if (isPlaying) {
                setIsPlaying(false);
                await unload();
                return;
            }
            setIsLoading(true);
            await unload();
            const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
            soundRef.current = sound;
            sound.setOnPlaybackStatusUpdate((status) => {
                if (status.isLoaded && status.didJustFinish) {
                    setIsPlaying(false);
                    unload();
                }
            });
            setIsPlaying(true);
        } catch (error) {
            console.warn('[AudioPlayButton] Playback failed:', error);
            setIsPlaying(false);
        } finally {
            setIsLoading(false);
        }
    };

    if (compact) {
        return (
            <TouchableOpacity style={styles.compactBtn} onPress={toggle} disabled={isLoading}>
                {isLoading ? (
                    <ActivityIndicator size="small" color="#2563EB" />
                ) : (
                    <Ionicons name={isPlaying ? 'stop' : 'play'} size={18} color="#2563EB" />
                )}
            </TouchableOpacity>
        );
    }

    return (
        <TouchableOpacity style={styles.btn} onPress={toggle} disabled={isLoading}>
            {isLoading ? (
                <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
            ) : (
                <Ionicons name={isPlaying ? 'stop' : 'play'} size={20} color="white" style={{ marginRight: 8 }} />
            )}
            <Text style={styles.btnText}>{isPlaying ? 'Stop' : 'Play'}</Text>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    btn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#2563EB',
        borderRadius: 8,
        paddingVertical: 12,
    },
    btnText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
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
