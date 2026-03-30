import { describe, expect, it } from "vitest";

import { finishCliOrgAccessWorkflow } from "./workflow";

describe("cli org access workflow", () => {
  it("reduces access effect results into terminal decisions", () => {
    expect(
      finishCliOrgAccessWorkflow({
        access: {
          kind: "found",
          org: {
            id: "org-1",
            slug: "acme",
            name: "Acme",
          },
          rawMembershipRole: "admin",
        },
        orgSlug: "acme",
      })
    ).toEqual({
      kind: "allowed",
      org: {
        id: "org-1",
        name: "Acme",
        slug: "acme",
      },
      rawMembershipRole: "admin",
    });
    expect(
      finishCliOrgAccessWorkflow({
        access: {
          kind: "not_found",
        },
        orgSlug: "acme",
      })
    ).toEqual({
      kind: "org_not_found",
      orgSlug: "acme",
    });
    expect(
      finishCliOrgAccessWorkflow({
        access: {
          kind: "forbidden",
        },
        orgSlug: "acme",
      })
    ).toEqual({
      kind: "forbidden",
      orgSlug: "acme",
    });
  });
});
