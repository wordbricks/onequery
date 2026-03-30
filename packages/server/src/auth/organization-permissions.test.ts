import { describe, expect, it } from "vitest";

import {
  doOrganizationRolesGrantPermission,
  organizationPermissionChecks,
} from "./organization-permissions";

describe("organization permissions", () => {
  it("treats malformed runtime role names as unauthorized instead of throwing", () => {
    expect(
      doOrganizationRolesGrantPermission({
        permission: organizationPermissionChecks.invitationCreate,
        roleNames: ["admin", "unknown-role"] as never,
      })
    ).toBe(true);

    expect(
      doOrganizationRolesGrantPermission({
        permission: organizationPermissionChecks.invitationCreate,
        roleNames: ["unknown-role"] as never,
      })
    ).toBe(false);
  });
});
