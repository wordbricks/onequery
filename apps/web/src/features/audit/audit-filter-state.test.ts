import type { AuditSearch } from "@onequery/contracts/audit";
import { describe, expect, it } from "vitest";

import {
  buildAuditSearchWithDraft,
  hasPendingAuditDraftFilters,
} from "@/features/audit/audit-filter-state";

describe("audit-filter-state", () => {
  it("applies the current text draft when an immediate filter changes", () => {
    const search: AuditSearch = {
      actionName: undefined,
      cursor: "older-cursor",
      family: undefined,
      limit: 25,
      outcome: undefined,
      q: undefined,
      sourceKey: undefined,
    };

    expect(
      buildAuditSearchWithDraft(
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
      actionName: undefined,
      cursor: undefined,
      family: undefined,
      limit: 25,
      outcome: "failed",
      q: "customers",
      sourceKey: "warehouse",
    } satisfies AuditSearch);
  });

  it("clears an incompatible action when the family changes", () => {
    const search: AuditSearch = {
      actionName: "execute",
      cursor: undefined,
      family: "query_action",
      limit: 25,
      outcome: undefined,
      q: "customers",
      sourceKey: undefined,
    };

    expect(
      buildAuditSearchWithDraft(
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
      actionName: undefined,
      cursor: undefined,
      family: "source_api_action",
      limit: 25,
      outcome: undefined,
      q: "customers",
      sourceKey: undefined,
    } satisfies AuditSearch);
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
