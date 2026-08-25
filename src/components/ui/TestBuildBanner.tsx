/**
 * Persistent "TEST BUILD" strip shown on every screen of apps bound to the
 * `test` OTA channel (the CoughCare Test app). The test and field apps are
 * visually identical once open; this makes them unmistakable everywhere, not
 * just on the login screen. Renders nothing on `preview`/`production` builds.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isTestBuild } from '../../utils/buildInfo';

export const TestBuildBanner: React.FC = () => {
    const insets = useSafeAreaInsets();

    if (!isTestBuild()) {
        return null;
    }

    return (
        // In normal layout flow (not an overlay): it pushes every screen down
        // instead of floating above them, so it can never cover a screen
        // header — overlaying at top:insets.top collided with headers on
        // devices with tall status bars/notches. It absorbs the status-bar
        // inset itself, painting the status-bar zone amber on test builds.
        <View pointerEvents="none" style={[styles.banner, { paddingTop: insets.top + 2 }]}>
            <Text style={styles.text}>TEST BUILD</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    banner: {
        backgroundColor: '#F59E0B',
        paddingBottom: 2,
        alignItems: 'center',
    },
    text: {
        color: 'white',
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 3,
    },
});
