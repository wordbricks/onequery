import { getCliRequestId } from "./request-context";
import type { CliRequestContext } from "./request-context";

type CliLogLevel = "info" | "warn" | "error";

type CliMetricTagValue = boolean | number | string;

type CliMetricTags = Record<string, CliMetricTagValue>;

type CliCounterMetricName =
  | "cli.auth.login_session_expiry_total"
  | "cli.org.authorization_failure_total"
  | "cli.org.resolution_failure_total"
  | "cli.query.action_trail_failure_total"
  | "cli.query.retryable_total"
  | "cli.query.timeout_total";

type CliHistogramMetricName =
  | "cli.auth.poll_duration_ms"
  | "cli.query.latency_ms";

type CliCounterMetricRecord = {
  name: CliCounterMetricName;
  tags: CliMetricTags;
  total: number;
};

type CliHistogramMetricRecord = {
  name: CliHistogramMetricName;
  tags: CliMetricTags;
  count: number;
  sum: number;
  min: number;
  max: number;
  last: number;
};

const cliCounterMetrics = new Map<string, CliCounterMetricRecord>();
const cliHistogramMetrics = new Map<string, CliHistogramMetricRecord>();

function normalizeCliMetricTags(
  tags: Record<string, CliMetricTagValue | null | undefined>
): CliMetricTags {
  const normalized: CliMetricTags = {};
  const sortedEntries = Object.entries(tags).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  for (const [key, value] of sortedEntries) {
    if (value === null || value === undefined) {
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

function buildCliMetricKey(name: string, tags: CliMetricTags): string {
  return `${name}:${JSON.stringify(tags)}`;
}

function roundMetricValue(value: number): number {
  return Math.max(0, Math.trunc(value));
}

export function recordCliCounterMetric(input: {
  name: CliCounterMetricName;
  tags?: Record<string, CliMetricTagValue | null | undefined>;
}) {
  const tags = normalizeCliMetricTags(input.tags ?? {});
  const key = buildCliMetricKey(input.name, tags);
  const current = cliCounterMetrics.get(key);

  if (!current) {
    cliCounterMetrics.set(key, {
      name: input.name,
      tags,
      total: 1,
    });
    return;
  }

  current.total += 1;
}

export function recordCliHistogramMetric(input: {
  name: CliHistogramMetricName;
  value: number;
  tags?: Record<string, CliMetricTagValue | null | undefined>;
}) {
  const tags = normalizeCliMetricTags(input.tags ?? {});
  const key = buildCliMetricKey(input.name, tags);
  const value = roundMetricValue(input.value);
  const current = cliHistogramMetrics.get(key);

  if (!current) {
    cliHistogramMetrics.set(key, {
      count: 1,
      last: value,
      max: value,
      min: value,
      name: input.name,
      sum: value,
      tags,
    });
    return;
  }

  current.count += 1;
  current.sum += value;
  current.min = Math.min(current.min, value);
  current.max = Math.max(current.max, value);
  current.last = value;
}

function writeCliLog(
  level: CliLogLevel,
  message: string,
  details: Record<string, unknown>
) {
  switch (level) {
    case "info": {
      console.info(message, details);
      return;
    }
    case "warn": {
      console.warn(message, details);
      return;
    }
    case "error": {
      console.error(message, details);
    }
  }
}

export function logCliEvent(input: {
  level: CliLogLevel;
  event: string;
  details: Record<string, unknown>;
}) {
  writeCliLog(input.level, `[cli] ${input.event}`, {
    event: input.event,
    scope: "cli",
    ...input.details,
  });
}

export function getCliLogLevelForStatus(status: number): CliLogLevel {
  if (status >= 500) {
    return "error";
  }

  if (status >= 400) {
    return "warn";
  }

  return "info";
}

type CliRequestLogContext = CliRequestContext & {
  req: {
    method: string;
    url: string;
  };
};

export function buildCliRequestLogDetails(
  c: CliRequestLogContext,
  extra: Record<string, unknown> = {}
) {
  return {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    requestId: getCliRequestId(c),
    ...extra,
  };
}

export function toCliErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// Comment: the server package does not yet expose a shared metrics backend,
// so CLI route metrics accumulate in-process here as a deliberate operational
// baseline until a real exporter is wired in.
