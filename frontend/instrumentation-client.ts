import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://5bade42aa6c2a0b2dae2f67ebcef2c38@o4511165656465408.ingest.us.sentry.io/4511170147975168",

  // Tracing
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Replay is loaded lazily below — keeping it out of `integrations` keeps the
  // ~90-110KB gzip recorder out of the render-blocking root bundle on every
  // page (login, landing, etc.).
  integrations: [
    Sentry.browserTracingIntegration(),
  ],

  // Only send errors in production
  enabled: process.env.NODE_ENV === "production",
});

// Load Session Replay after the page is interactive so it never blocks first
// paint. Same sampling as before (10% of sessions, 100% of error sessions).
if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
  const addReplay = () => {
    Sentry.lazyLoadIntegration("replayIntegration")
      .then((replayIntegration) => {
        Sentry.addIntegration(replayIntegration());
      })
      .catch(() => { /* replay is best-effort */ });
  };
  if (document.readyState === "complete") addReplay();
  else window.addEventListener("load", addReplay, { once: true });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
