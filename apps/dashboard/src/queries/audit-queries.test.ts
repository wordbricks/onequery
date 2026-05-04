import { auditListParamsSchema } from "@onequery/audit-contracts/audit";
import { describe, expect, it } from "vitest";

import {
  AUDIT_LIVE_REFETCH_INTERVAL_MS,
  AUDIT_PROJECTION_CATCH_UP_REFETCH_INTERVAL_MS,
  auditListQueryOptions,
  resolveAuditListRefetchInterval,
} from "@/queries/audit-queries";

describe("audit query options", () => {
  it("uses one canonical params schema for route and API audit list inputs", () => {
    expect(auditListParamsSchema.parse({})).toEqual({ limit: 25 });
    expect(
      auditListParamsSchema.parse({
        limit: "50",
        q: " customers ",
        sourceKey: "   ",
      })
    ).toEqual({
      limit: 50,
      q: "customers",
    });
    expect(() => auditListParamsSchema.parse({ limit: "bad" })).toThrow();
  });

  it("rejects incompatible family and action filters", () => {
    expect(() =>
      auditListParamsSchema.parse({
        actionName: "execute",
        family: "source_api_action",
      })
    ).toThrow();
  });

  it("treats audit data as immediately stale", () => {
    const options = auditListQueryOptions("user_1", "acme", { limit: 25 });

    expect(options.staleTime).toBe(0);
    expect(options.refetchOnMount).toBe("always");
    expect(options.refetchOnReconnect).toBe("always");
    expect(options.refetchOnWindowFocus).toBe("always");
  });

  it("polls the newest page slowly after the projection catches up", () => {
    expect(
      resolveAuditListRefetchInterval({
        data: {
          projectionLag: {
            queryAction: false,
            sourceApiAction: false,
          },
        },
        params: {},
      })
    ).toBe(AUDIT_LIVE_REFETCH_INTERVAL_MS);
  });

  it("polls faster while the projection reports lag", () => {
    expect(
      resolveAuditListRefetchInterval({
        data: {
          projectionLag: {
            queryAction: true,
            sourceApiAction: false,
          },
        },
        params: {},
      })
    ).toBe(AUDIT_PROJECTION_CATCH_UP_REFETCH_INTERVAL_MS);
  });

  it("does not poll older cursor pages", () => {
    expect(
      resolveAuditListRefetchInterval({
        data: {
          projectionLag: {
            queryAction: true,
            sourceApiAction: true,
          },
        },
        params: { cursor: "older" },
      })
    ).toBe(false);
  });
});
