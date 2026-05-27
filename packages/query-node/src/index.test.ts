import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { createQueryNodeRuntime } from ".";

describe("createQueryNodeRuntime", () => {
  it("composes a query service from the Node provider registry", () => {
    const runtime = createQueryNodeRuntime();

    expect(Object.keys(runtime.registry).sort()).toEqual([
      "bigquery",
      "cloudflare_d1",
      "laminar",
      "motherduck",
      "mysql",
      "postgres",
      "snowflake",
    ]);
    expect(runtime.service.executeDatabaseQuery).toBeTypeOf("function");
  });

  it("adds the Athena connector driver only when a broker queue is injected", () => {
    const runtime = createQueryNodeRuntime({
      athenaConnector: {
        queueJob: async () =>
          Result.ok({
            columns: [{ name: "ok", type: "boolean" }],
            jobId: "job_1",
            rows: [["true"]],
            status: "success",
          }),
      },
    });

    expect(Object.keys(runtime.registry).sort()).toEqual([
      "aws_athena_connector",
      "bigquery",
      "cloudflare_d1",
      "laminar",
      "motherduck",
      "mysql",
      "postgres",
      "snowflake",
    ]);
  });
});
