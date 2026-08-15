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
        runtimeVersion: safe(() => Updates.runtimeVersion, '?'),
        channel: safe(() => Updates.channel, 'development'),
        bundleId: isEmbedded || !updateId ? 'embedded' : updateId.slice(0, 8),
        isEmbedded,
    };
};

/** One-line summary for display, e.g. "v1.0.0 · rtv 1.1.0 · preview · 019edabd" */
export const getBuildInfoLine = (): string => {
    const info = getBuildInfo();
    return `v${info.appVersion} · rtv ${info.runtimeVersion} · ${info.channel} · ${info.bundleId}`;
};
