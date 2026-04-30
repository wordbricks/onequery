import { describe, expect, it } from "vitest";

import {
  hasOrganizationPermission,
  resolveOrganizationRoleNames,
  serializeOrganizationRoleNames,
} from "@/lib/organization-role-access";

describe("organization role access", () => {
  it("normalizes multi-role strings in canonical order", () => {
    expect(
      resolveOrganizationRoleNames("admin, owner, owner, unknown, member")
    ).toEqual(["admin", "owner", "member"]);

    expect(serializeOrganizationRoleNames(["member", "owner", "admin"])).toBe(
      "owner,admin,member"
    );
  });

  it("uses the shared Better Auth permission matrix", () => {
    expect(
      hasOrganizationPermission({
        permission: "organizationUpdate",
        rawRole: "owner",
      })
    ).toBe(true);

    expect(
      hasOrganizationPermission({
        permission: "memberUpdate",
        rawRole: "member",
      })
    ).toBe(false);
  });
});
