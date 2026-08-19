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
        <View pointerEvents="none" style={[styles.banner, { top: insets.top }]}>
            <Text style={styles.text}>TEST BUILD</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    banner: {
        position: 'absolute',
        left: 0,
        right: 0,
        zIndex: 9999,
        elevation: 12,
        backgroundColor: 'rgba(245, 158, 11, 0.92)',
        paddingVertical: 2,
        alignItems: 'center',
    },
    text: {
        color: 'white',
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 3,
    },
});
