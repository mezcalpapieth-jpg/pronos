import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';

export function initSentry() {
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: `pronos-mvp@${import.meta.env.VITE_COMMIT_SHA || 'dev'}`,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    tracesSampleRate: 0.2,      // 20% of transactions
    replaysSessionSampleRate: 0, // No session replays
    replaysOnErrorSampleRate: 0, // No error replays

    // Don't send errors from dev
    enabled: import.meta.env.PROD,

    // Ignore noisy errors
    ignoreErrors: [
      'ResizeObserver loop',
      'Non-Error promise rejection',
      'Network request failed',
      'Load failed',
    ],

    beforeSend(event) {
      // Strip wallet addresses from error messages for privacy
      if (event.message) {
        event.message = event.message.replace(/0x[a-fA-F0-9]{40}/g, '0x[REDACTED]');
      }
      return event;
    },
  });
}

export { Sentry };
