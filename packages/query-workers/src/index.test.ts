import { createPreparedReadOnlyQuery } from "@onequery/query/types";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { createQueryWorkersRuntime } from ".";

describe("createQueryWorkersRuntime", () => {
  it("composes a query service from the Workers provider registry", () => {
    const runtime = createQueryWorkersRuntime({
      validator: {
        validateReadOnlySql: async ({ provider, sql }) =>
          Result.ok(
            createPreparedReadOnlyQuery({
              normalizedSql: sql,
              provider,
            })
          ),
      },
    });

    expect(Object.keys(runtime.registry).sort()).toEqual([
      "bigquery",
      "cloudflare_d1",
      "laminar",
    ]);
    expect(runtime.service.executeDatabaseQuery).toBeTypeOf("function");
  });
});
