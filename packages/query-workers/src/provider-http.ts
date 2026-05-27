export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_PROVIDER_REQUEST_TIMEOUT_MS = 120_000;
export const MAX_PROVIDER_ERROR_DETAIL_LENGTH = 500;

export function normalizeProviderRequestTimeout(
  timeoutMs: number | undefined
): number {
  if (timeoutMs === undefined) {
    return DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("timeoutMs must be an integer >= 1");
  }
  return Math.min(timeoutMs, MAX_PROVIDER_REQUEST_TIMEOUT_MS);
}
