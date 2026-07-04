import * as Sentry from '@sentry/nextjs';

/**
 * Log an error with context, and report it to Sentry (which is configured).
 */
export function logError(error: unknown, context?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context ?? 'Error'}]`, message, error);
  Sentry.captureException(error, context ? { extra: { context } } : undefined);
}

/**
 * Wrapper for fire-and-forget async operations.
 */
export function fireAndForget(promise: Promise<unknown>, context: string): void {
  promise.catch((error) => logError(error, context));
}
