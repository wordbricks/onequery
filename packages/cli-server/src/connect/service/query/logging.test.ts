import { beforeEach, describe, expect, it, vi } from "vitest";

import type { logCliEvent as logCliEventFn } from "../../../observability";
import { createCliQueryLogging } from "./logging";

describe("query logging", () => {
  const buildCliRequestLogDetails = vi.fn(
    (_c: unknown, extra: Record<string, unknown> = {}) => ({
      method: "POST",
      path: "/connectrpc/onequery.cli.v1.CliQueryService/ExecuteQuery",
      requestId: "req-query-log-1",
      ...extra,
    })
  );
  const logCliEvent = vi.fn<typeof logCliEventFn>();
  const recordCliCounterMetric = vi.fn(() => {});
  const logging = createCliQueryLogging({
    buildCliRequestLogDetails,
    logCliEvent,
    recordCliCounterMetric,
  });

  beforeEach(() => {
    buildCliRequestLogDetails.mockClear();
    logCliEvent.mockClear();
    recordCliCounterMetric.mockClear();
  });

  it("logs query.plan.accepted for validation success", () => {
    logging.logCliQueryValidationAccepted({
      c: {} as never,
      provider: "postgres",
      sourceKey: "warehouse",
      truncated: false,
    });

    expect(logCliEvent).toHaveBeenCalledTimes(1);
    expect(logCliEvent).toHaveBeenCalledWith({
      details: {
        method: "POST",
        path: "/connectrpc/onequery.cli.v1.CliQueryService/ExecuteQuery",
        provider: "postgres",
        requestId: "req-query-log-1",
        source: "warehouse",
        truncated: false,
      },
      event: "query.plan.accepted",
      level: "info",
    });
  });

  it("logs only query.execution.succeeded for execution success", () => {
    logging.logCliQueryExecutionSuccess({
      c: {} as never,
      durationMs: 42,
      response: {
        elapsedMs: 18,
        rowCount: 3,
        source: {
          provider: "postgres",
        },
        truncated: true,
      },
      sourceKey: "warehouse",
    } as never);

    expect(logCliEvent).toHaveBeenCalledTimes(1);
    expect(logCliEvent).toHaveBeenCalledWith({
      details: {
        method: "POST",
        path: "/connectrpc/onequery.cli.v1.CliQueryService/ExecuteQuery",
        durationMs: 42,
        provider: "postgres",
        queryElapsedMs: 18,
        requestId: "req-query-log-1",
        rowCount: 3,
        source: "warehouse",
        truncated: true,
      },
      event: "query.execution.succeeded",
      level: "info",
    });
    expect(
      logCliEvent.mock.calls.some(
        ([input]) =>
          (input as { event: string }).event === "query.plan.accepted"
      )
    ).toBe(false);
  });
});
