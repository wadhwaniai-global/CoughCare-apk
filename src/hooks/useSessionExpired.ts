/**
 * Whether this phone's login has run out, judged on the phone alone, so the
 * Dashboard can say so while offline (collection carries on; the next sync
 * needs a new login). The server stays the only judge of a session: this
 * never logs anyone out, it only drives the notice.
 *
 * The expiry moment comes from AuthService.getSessionExpiresAt, on the phone's
 * own clock. It is read when the Dashboard comes into view; a minute timer and
 * the return to the app catch the moment it passes while the Dashboard is open.
 */

import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { authService } from '../services/AuthService';

const RECHECK_MS = 60 * 1000;

export const useSessionExpired = (): boolean => {
    const [expired, setExpired] = useState(false);

    useFocusEffect(
        useCallback(() => {
            let expiresAt: number | null = null;
            let active = true;
            const check = () => {
                if (active) setExpired(expiresAt !== null && Date.now() >= expiresAt);
            };
            authService.getSessionExpiresAt()
                .then((at) => { expiresAt = at; check(); })
                .catch(() => {});
            const timer = setInterval(check, RECHECK_MS);
            const subscription = AppState.addEventListener('change', (state) => {
                if (state === 'active') check();
            });
            return () => {
                active = false;
                clearInterval(timer);
                subscription.remove();
            };
        }, [])
    );

    return expired;
};
