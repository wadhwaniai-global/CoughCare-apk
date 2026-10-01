/**
 * Session-ended signal from the network layer to the UI.
 *
 * The server is the only judge of a session: a 401 on an authenticated call
 * ends it. The phone never decides expiry on its own (no clock check, no
 * decoding of the token), so being offline can never log a collector out.
 *
 * ApiService emits; AuthContext listens and takes the collector to the Login
 * screen (once any open data-entry screen has been left, see holdSignOut).
 */

export type SessionEndReason =
  | 'expired'  // the server answered 401: expired, revoked or disabled
  | 'missing'; // no token on the phone, so no request was sent

export class SessionEndedError extends Error {
  readonly reason: SessionEndReason;
  constructor(reason: SessionEndReason) {
    super(reason === 'expired'
      ? 'Your login has expired. Log in again to sync.'
      : 'You are not logged in. Log in again to sync.');
    this.name = 'SessionEndedError';
    this.reason = reason;
  }
}

export const isSessionEnded = (error: unknown): error is SessionEndedError =>
  error instanceof SessionEndedError || (error as any)?.name === 'SessionEndedError';

type Listener = (reason: SessionEndReason) => void;
const listeners = new Set<Listener>();

export const onSessionEnded = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const emitSessionEnded = (reason: SessionEndReason): void => {
  for (const listener of [...listeners]) {
    try {
      listener(reason);
    } catch (error) {
      console.warn('[Session] listener failed:', error);
    }
  }
};
