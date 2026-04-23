import { describe, expect, it } from "vitest";

import {
  AUDIT_LIVE_REFETCH_INTERVAL_MS,
  AUDIT_PROJECTION_CATCH_UP_REFETCH_INTERVAL_MS,
  auditListQueryOptions,
  resolveAuditListRefetchInterval,
} from "@/queries/audit-queries";

describe("audit query options", () => {
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
        search: { cursor: undefined },
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
        search: { cursor: undefined },
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
        search: { cursor: "older" },
      })
    ).toBe(false);
  });
});
