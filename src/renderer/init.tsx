import * as Sentry from '@sentry/react';
import { STATIC_JNDATA } from '../common/jndata';

const diagnostics = __SENTRY_DIAGNOSTICS_ENABLED__;

Sentry.init({
  dsn: 'https://7efc433d64654b98935da24646165cb7@o530070.ingest.sentry.io/4504833087242240',
  enabled: import.meta.env.PROD || diagnostics,
  tracesSampleRate: diagnostics ? 1 : 0,
  replaysSessionSampleRate: diagnostics ? 1 : 0,
  replaysOnErrorSampleRate: 0,
});

if (diagnostics) {
  void import('./sentryDiagnostics').then(({ default: enableDiagnostics }) =>
    enableDiagnostics(),
  );
}

Sentry.setUser({ fullName: window.id });
window.__JNdata = STATIC_JNDATA;
