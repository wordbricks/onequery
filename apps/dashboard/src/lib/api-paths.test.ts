import { describe, expect, it } from "vitest";

import {
  APP_API_PATH,
  AUTH_BOOTSTRAP_STATE_API_PATH,
  buildTeamOrganizationApiPath,
  TEAM_ORGANIZATIONS_API_PREFIX,
} from "@/lib/api-paths";

describe("api paths", () => {
  it("keeps the public app api prefix in one place", () => {
    expect(APP_API_PATH).toBe("/api");
    expect(AUTH_BOOTSTRAP_STATE_API_PATH).toBe("/api/auth/bootstrap-state");
    expect(TEAM_ORGANIZATIONS_API_PREFIX).toBe("/api/team/organizations");
  });

  it("builds organization-scoped team api paths", () => {
    expect(
      buildTeamOrganizationApiPath("org_123", "members", "user_456", "role")
    ).toBe("/api/team/organizations/org_123/members/user_456/role");
  });
});
