import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://5bade42aa6c2a0b2dae2f67ebcef2c38@o4511165656465408.ingest.us.sentry.io/4511170147975168",

  // Tracing
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration(),
    Sentry.browserTracingIntegration(),
  ],

  // Only send errors in production
  enabled: process.env.NODE_ENV === "production",
});
