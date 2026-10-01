/**
 * Custom hook for managing audio recording functionality
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Platform, Alert, AppState } from 'react-native';
import { Audio } from 'expo-av';
import { detectCoughFromUrl } from '../utils/onnxInference';
import { AnalysisResult } from '../types/participantForm';
import { AudioRecorder } from '../utils/audioRecorder';
import { computeAudioQuality, AudioQuality } from '../utils/audioQuality';

/**
 * Takes stop on their own at this length. Guards storage and upload size, and
 * matches the cough detector's 60 s buffer. The cap lives here, in the hook
 * that owns the recorder, and runs on the wall clock: a cap in the recording
 * card (as before 2026-10) disappeared when Section D was closed, and a
 * JS tick counter stops while the app is off screen while the native
 * recorder keeps writing. Either let a take run for minutes and grow past
 * the server's upload limit (field report 2026-09-30).
 */
export const MAX_RECORDING_SECONDS = 60;

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * Keep the screen on while a take runs (at most 60 s): a screen that times
 * out mid-take takes the app off screen, which stops the take. expo-keep-awake's
 * native module is in every CoughCare APK built so far (checked 2026-10-01);
 * it is loaded here, guarded, so a binary without it records as before
 * instead of failing.
 */
const KEEP_AWAKE_TAG = 'coughcare-recording';
const keepScreenOn = (on: boolean) => {
    try {
        const keepAwake = require('expo-keep-awake');
        const pending = on
            ? keepAwake.activateKeepAwakeAsync(KEEP_AWAKE_TAG)
            : keepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG);
        Promise.resolve(pending).catch(() => {});
    } catch {
        // Not in this binary: the screen may sleep as before
    }
};

interface UseAudioRecordingOptions {
    /** A take the hook stopped on its own (the 60 s cap, or the app leaving the
     *  screen): the screen must still put it into the form, because the
     *  recording section may be closed and its card unmounted. */
    onAutoStop?: (key: string, uri: string) => void;
}

export const useAudioRecording = (options: UseAudioRecordingOptions = {}) => {
    const [activeRecordingKey, setActiveRecordingKey] = useState<string | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [recordedDurations, setRecordedDurations] = useState<Record<string, number>>({});
    const [analysisResults, setAnalysisResults] = useState<Record<string, AnalysisResult>>({});
    // Signal metrics per take (level, clipping, noise floor, start-up zero
    // padding), uploaded with the recording so the dashboard can catch a
    // device model whose microphone path misbehaves. null = not computed.
    const [takeQuality, setTakeQuality] = useState<Record<string, AudioQuality | null>>({});
    // Slots whose take is being finished (native stop, signal metrics, cough
    // analysis). Their card shows a spinner, so a tap cannot start a second
    // take that would silently replace the first.
    const [processingKeys, setProcessingKeys] = useState<Record<string, true>>({});

    const recorderRef = useRef<AudioRecorder | null>(null);
    const recordingInterval = useRef<NodeJS.Timeout | null>(null);
    // Claimed synchronously by startRecording, so a double tap or a second
    // card cannot start a second take while the first starts or records
    const activeKeyRef = useRef<string | null>(null);
    const startedAtRef = useRef(0);
    // The stop in flight; later callers (Stop tap, cap, app leaving) share it
    const stopPromiseRef = useRef<Promise<string | null> | null>(null);
    const onAutoStopRef = useRef(options.onAutoStop);
    onAutoStopRef.current = options.onAutoStop;
    // Takes (by file uri) whose "No Cough Detected" question was already
    // shown. Kept here, not in the card: Section D unmounts its cards whenever
    // another section opens, and the question used to come back each time.
    const noCoughAskedRef = useRef(new Set<string>());

    const elapsedSeconds = () => Math.floor((nowMs() - startedAtRef.current) / 1000);

    useEffect(() => {
        (async () => {
            const { status } = await Audio.requestPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Required', 'Microphone permission is required to record audio.');
            }
        })();

        // Initialize recorder
        recorderRef.current = new AudioRecorder();

        return () => {
            // Cleanup
            if (recorderRef.current) {
                recorderRef.current.cleanup();
            }
            if (recordingInterval.current) {
                clearInterval(recordingInterval.current);
            }
            keepScreenOn(false);
        };
    }, []);

    const setProcessing = (key: string, on: boolean) => {
        setProcessingKeys(prev => {
            const next = { ...prev };
            if (on) next[key] = true; else delete next[key];
            return next;
        });
    };

    const analyzeAudio = async (key: string, uri: string) => {
        setAnalysisResults(prev => ({ ...prev, [key]: { loading: true } }));
        try {
            let audioUri = uri;
            if (Platform.OS !== 'web' && !audioUri.startsWith('http') && !audioUri.startsWith('file://') && !audioUri.startsWith('/')) {
                audioUri = 'file://' + audioUri;
            }

            const result = await detectCoughFromUrl(audioUri);
            console.log(`Analysis Result for ${key}:`, result);
            setAnalysisResults(prev => ({ ...prev, [key]: { loading: false, result } }));
        } catch (error) {
            console.error(`Analysis failed for ${key}:`, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            setAnalysisResults(prev => ({ ...prev, [key]: { loading: false, error: errorMessage } }));
        }
    };

    const startRecording = async (key: string) => {
        if (activeKeyRef.current || stopPromiseRef.current || !recorderRef.current) return;
        activeKeyRef.current = key;

        try {
            // Ensure audio mode is set for recording
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
            });

            await recorderRef.current.start();
            keepScreenOn(true);

            startedAtRef.current = nowMs();
            setActiveRecordingKey(key);
            setRecordingDuration(0);

            // The timer shows wall-clock seconds and enforces the cap. If the
            // app was paused, the first tick after it comes back catches up.
            recordingInterval.current = setInterval(() => {
                const seconds = elapsedSeconds();
                setRecordingDuration(seconds);
                if (seconds >= MAX_RECORDING_SECONDS) {
                    void autoStop();
                }
            }, 250);

        } catch (err) {
            activeKeyRef.current = null;
            keepScreenOn(false);
            console.error('Failed to start recording', err);
            Alert.alert('Error', 'Failed to start recording.');
        }
    };

    const stopRecording = (key: string): Promise<string | null> => {
        if (stopPromiseRef.current) return stopPromiseRef.current;
        if (activeKeyRef.current !== key || !recorderRef.current) return Promise.resolve(null);

        // The length is taken when the stop is requested, capped: the native
        // stop takes a moment, and a capped take must not be stored as 61 s
        // (the dashboard treats kept takes over 60 s as an app fault).
        const finalDuration = Math.min(elapsedSeconds(), MAX_RECORDING_SECONDS);
        if (recordingInterval.current) {
            clearInterval(recordingInterval.current);
            recordingInterval.current = null;
        }
        setProcessing(key, true);

        const run = (async (): Promise<string | null> => {
            let uri: string | null = null;
            try {
                uri = await recorderRef.current!.stop();
            } catch (error) {
                console.error('Failed to stop recording', error);
                const detail = error instanceof Error ? error.message : String(error);
                Alert.alert('Error', `Failed to stop recording.\n\n${detail}`);
            } finally {
                // The recorder is free again (also after a failed stop, which
                // used to leave the form stuck in the recording state)
                keepScreenOn(false);
                activeKeyRef.current = null;
                stopPromiseRef.current = null;
                setActiveRecordingKey(null);
                setRecordingDuration(0);
            }

            try {
                if (uri) {
                    setRecordedDurations(prev => ({ ...prev, [key]: finalDuration }));

                    // Cheap (one pass over the PCM) and fail-safe: a null never
                    // blocks the take. Awaited so the metrics exist by the time
                    // the form can be saved.
                    const quality = await computeAudioQuality(uri, recorderRef.current?.getLastTakeWallSeconds() ?? null);
                    setTakeQuality(prev => ({ ...prev, [key]: quality }));

                    // The ambient clip is never scored for cough — SectionD renders no
                    // analysis for it — and it is the longest recording in the form
                    // (10s minimum), so running the ONNX pipeline on it is pure cost and
                    // risk. The cough recordings are still awaited: submission reads
                    // analysisResults, so analysis must finish before the form is savable.
                    if (key !== 'recordingBackground') {
                        await analyzeAudio(key, uri);
                    }
                }
                return uri;
            } finally {
                setProcessing(key, false);
            }
        })();

        stopPromiseRef.current = run;
        return run;
    };

    /** Stop the take in progress on the hook's own initiative (cap, app leaving). */
    const autoStop = async () => {
        const key = activeKeyRef.current;
        if (!key || stopPromiseRef.current) return;
        const uri = await stopRecording(key);
        if (uri) onAutoStopRef.current?.(key, uri);
    };
    const autoStopRef = useRef(autoStop);
    autoStopRef.current = autoStop;

    // Leaving the screen (screen off, power key, a call, another app) stops the
    // take at that moment. Android pauses JS timers while the app is away but
    // the native recorder keeps writing, which is how takes ran for minutes.
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state !== 'active') void autoStopRef.current();
        });
        return () => subscription.remove();
    }, []);

    const clearRecording = (key: string) => {
        setRecordedDurations(prev => {
            const newDurations = { ...prev };
            delete newDurations[key];
            return newDurations;
        });
        setAnalysisResults(prev => {
            const newResults = { ...prev };
            delete newResults[key];
            return newResults;
        });
        setTakeQuality(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    const wasNoCoughAsked = useCallback((uri: string) => noCoughAskedRef.current.has(uri), []);
    const markNoCoughAsked = useCallback((uri: string) => { noCoughAskedRef.current.add(uri); }, []);

    // Get audio duration from file
    const getAudioDuration = async (uri: string): Promise<number> => {
        try {
            if (Platform.OS === 'web') {
                // For web, use HTML5 Audio API
                return new Promise((resolve, reject) => {
                    const audio = new (window as any).Audio(uri);
                    audio.addEventListener('loadedmetadata', () => {
                        const duration = Math.round(audio.duration);
                        if (isFinite(duration) && duration > 0) {
                            resolve(duration);
                        } else {
                            resolve(10); // Fallback
                        }
                    });
                    audio.addEventListener('error', () => {
                        resolve(10); // Fallback on error
                    });
                    audio.load();
                });
            } else {
                // For React Native, use expo-av
                const { sound } = await Audio.Sound.createAsync(
                    { uri },
                    { shouldPlay: false }
                );
                const status = await sound.getStatusAsync();
                await sound.unloadAsync();
                if (status.isLoaded && status.durationMillis) {
                    return Math.round(status.durationMillis / 1000);
                }
                return 10; // Fallback
            }
        } catch (error) {
            console.warn('Could not get audio duration:', error);
            return 10; // Fallback
        }
    };

    // Expose analyzeAudio for manual calls (e.g., sample audio)
    const analyzeAudioManually = async (key: string, uri: string) => {
        // Get actual duration from audio file
        const duration = await getAudioDuration(uri);
        setRecordedDurations(prev => ({ ...prev, [key]: duration }));
        // Then analyze
        await analyzeAudio(key, uri);
    };

    const initRecordedDurations = (durations: Record<string, number>) => {
        setRecordedDurations(prev => ({ ...prev, ...durations }));
    };

    // Seed analysis state when loading a saved record for editing — analysis
    // is never re-run on load, so without this an edit round-trip saves every
    // take (and the participant's primary result) with a null confidence.
    const initAnalysisResults = (results: Record<string, AnalysisResult>) => {
        setAnalysisResults(prev => ({ ...results, ...prev }));
    };

    return {
        activeRecordingKey,
        recordingDuration,
        recordedDurations,
        analysisResults,
        takeQuality,
        processingKeys,
        startRecording,
        stopRecording,
        clearRecording,
        wasNoCoughAsked,
        markNoCoughAsked,
        analyzeAudioManually,
        initRecordedDurations,
        initAnalysisResults,
    };
};
