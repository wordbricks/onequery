import { describe, expect, it } from "vitest";

import { exportMixpanelEvents, fetchMixpanelQueryApi } from "./relay";

const credentials = {
  projectId: "project-123",
  region: "us" as const,
  secret: "mixpanel-secret",
  type: "mixpanel" as const,
  username: "service-account",
  workspaceId: "workspace-456",
};

describe("mixpanel relay", () => {
  it("rejects reserved project and workspace params", async () => {
    await expect(
      fetchMixpanelQueryApi({
        credentials,
        endpoint: "/query/engage",
        options: {
          params: {
            project_id: "other-project",
          },
        },
      })
    ).rejects.toThrow('Mixpanel params key "project_id" is reserved');
  });

  it("rejects dot-segment endpoints that escape the query API base path", async () => {
    await expect(
      fetchMixpanelQueryApi({
        credentials,
        endpoint: "/query/../secrets",
      })
    ).rejects.toThrow("Mixpanel endpoint must not contain dot segments");
  });

  it("rejects reserved body keys for export requests", async () => {
    await expect(
      exportMixpanelEvents({
        credentials,
        options: {
          body: {
            project_id: "other-project",
          },
          bodyFormat: "json",
          method: "POST",
        },
      })
    ).rejects.toThrow('Mixpanel body key "project_id" is reserved');
  });
});
