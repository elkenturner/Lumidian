/**
 * Log an error with context. In production, this would send to Sentry.
 */
export function logError(error: unknown, context?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context ?? 'Error'}]`, message, error);
  // TODO: When Sentry is configured, add: Sentry.captureException(error, { extra: { context } });
}

/**
 * Wrapper for fire-and-forget async operations.
 */
export function fireAndForget(promise: Promise<unknown>, context: string): void {
  promise.catch((error) => logError(error, context));
}
