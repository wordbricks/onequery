import { describe, expect, it } from "vitest";

import { finishCliOrgAccessWorkflow } from "./workflow";

describe("cli org access workflow", () => {
  it("reduces access effect results into terminal decisions", () => {
    expect({
      allowed: finishCliOrgAccessWorkflow({
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
      }),
      forbidden: finishCliOrgAccessWorkflow({
        access: {
          kind: "forbidden",
        },
        orgSlug: "acme",
      }),
      notFound: finishCliOrgAccessWorkflow({
        access: {
          kind: "not_found",
        },
        orgSlug: "acme",
      }),
    }).toMatchSnapshot();
  });
});
