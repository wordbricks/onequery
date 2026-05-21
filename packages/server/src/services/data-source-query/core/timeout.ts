export const QUERY_TIMEOUT_MS = 10_000;
const MAX_QUERY_TIMEOUT_MS = 60_000;

export type QueryDeadline = {
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
  readonly timeoutMs: number;
  remainingMs(): number;
  createAbortSignal(): AbortSignal | undefined;
};

export function resolveQueryTimeoutMs(
  clientTimeoutMs: number | null | undefined
): number {
  if (
    typeof clientTimeoutMs !== "number" ||
    !Number.isFinite(clientTimeoutMs) ||
    clientTimeoutMs <= 0
  ) {
    return QUERY_TIMEOUT_MS;
  }

  const rounded = Math.trunc(clientTimeoutMs);
  return Math.min(Math.max(rounded, 1000), MAX_QUERY_TIMEOUT_MS);
}

export function createQueryDeadline(
  clientTimeoutMs: number | null | undefined
): QueryDeadline {
  const timeoutMs = resolveQueryTimeoutMs(clientTimeoutMs);
  const startedAtMs = Date.now();
  const expiresAtMs = startedAtMs + timeoutMs;

  return {
    startedAtMs,
    expiresAtMs,
    timeoutMs,
    remainingMs: () => Math.max(1, expiresAtMs - Date.now()),
    createAbortSignal: () => createTimeoutSignal(timeoutMs),
  };
}

export function createTimeoutSignal(
  timeoutMs: number
): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined") {
    return undefined;
  }

  if (typeof AbortSignal.timeout !== "function") {
    return undefined;
  }

  return AbortSignal.timeout(timeoutMs);
}
