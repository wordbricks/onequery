import type { AuditListParams } from "@onequery/audit-contracts/audit";
import { describe, expect, it } from "vitest";

import {
  buildAuditListParamsWithDraft,
  hasPendingAuditDraftFilters,
} from "@/features/audit/audit-filter-state";

describe("audit-filter-state", () => {
  it("applies the current text draft when an immediate filter changes", () => {
    const search: AuditListParams = {
      cursor: "older-cursor",
      limit: 25,
    };

    expect(
      buildAuditListParamsWithDraft(
        search,
        {
          q: "customers",
          sourceKey: "warehouse",
        },
        {
          cursor: undefined,
          outcome: "failed",
        }
      )
    ).toEqual({
      limit: 25,
      outcome: "failed",
      q: "customers",
      sourceKey: "warehouse",
    } satisfies AuditListParams);
  });

  it("clears an incompatible action when the family changes", () => {
    const search: AuditListParams = {
      actionName: "execute",
      family: "query_action",
      limit: 25,
      q: "customers",
    };

    expect(
      buildAuditListParamsWithDraft(
        search,
        {
          q: "customers",
          sourceKey: "",
        },
        {
          cursor: undefined,
          family: "source_api_action",
        }
      )
    ).toEqual({
      family: "source_api_action",
      limit: 25,
      q: "customers",
    } satisfies AuditListParams);
  });

  it("treats whitespace-only differences as unchanged draft filters", () => {
    expect(
      hasPendingAuditDraftFilters(
        {
          q: "customers",
          sourceKey: undefined,
        },
        {
          q: " customers ",
          sourceKey: "   ",
        }
      )
    ).toBe(false);
  });
});
