/**
 * Build / OTA bundle identification.
 *
 * Surfaced in the app so a field tester can tell support exactly which JS
 * bundle they are running. This is also how an OTA rollout is verified: after
 * `eas update`, the bundle id here changes from "embedded" to a short update id.
 *
 * All expo-updates values are read defensively — in a dev client or Expo Go,
 * updates are disabled and these are null or throw.
 */

import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export interface BuildInfo {
    /** App version, e.g. "1.0.0" */
    appVersion: string;
    /**
     * Monotonic bundle sequence — the git commit count at bundle time, inlined
     * by Metro from EXPO_PUBLIC_BUNDLE_SEQ (set by scripts/ota-publish.mjs and
     * scripts/build-test-apk.sh). Comparable across channels: test #680 vs
     * field #674 means the field bundle is 6 changes behind; equal means the
     * two apps run identical code. "?" when built without the variable.
     */
    bundleSeq: string;
    /** OTA compatibility key. Only updates with a matching value can be applied. */
    runtimeVersion: string;
    /** OTA channel this binary is bound to, e.g. "preview". Fixed at build time. */
    channel: string;
    /** Short id of the running bundle, or "embedded" when running the APK's own bundle. */
    bundleId: string;
    /** True when running the bundle shipped inside the APK (no OTA applied). */
    isEmbedded: boolean;
}

const safe = <T,>(read: () => T | null | undefined, fallback: T): T => {
    try {
        const value = read();
        return value == null ? fallback : value;
    } catch {
        return fallback;
    }
};

export const getBuildInfo = (): BuildInfo => {
    const isEmbedded = safe(() => Updates.isEmbeddedLaunch, true);
    const updateId = safe(() => Updates.updateId, null as string | null);

    return {
        appVersion: safe(() => Constants.expoConfig?.version, '?'),
        bundleSeq: process.env.EXPO_PUBLIC_BUNDLE_SEQ || '?',
        runtimeVersion: safe(() => Updates.runtimeVersion, '?'),
        channel: safe(() => Updates.channel, 'development'),
        bundleId: isEmbedded || !updateId ? 'embedded' : updateId.slice(0, 8),
        isEmbedded,
    };
};

/** One-line summary for display, e.g. "v1.0.0 #681 · rtv 1.1.0 · preview · 019edabd" */
export const getBuildInfoLine = (): string => {
    const info = getBuildInfo();
    const seq = info.bundleSeq === '?' ? '' : ` #${info.bundleSeq}`;
    return `v${info.appVersion}${seq} · rtv ${info.runtimeVersion} · ${info.channel} · ${info.bundleId}`;
};
