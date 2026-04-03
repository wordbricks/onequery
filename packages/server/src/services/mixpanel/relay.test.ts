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
  it.each([
    [
      "reserved project and workspace params",
      () =>
        fetchMixpanelQueryApi({
          credentials,
          endpoint: "/query/engage",
          options: {
            params: {
              project_id: "other-project",
            },
          },
        }),
      'Mixpanel params key "project_id" is reserved',
    ],
    [
      "dot-segment endpoints that escape the query API base path",
      () =>
        fetchMixpanelQueryApi({
          credentials,
          endpoint: "/query/../secrets",
        }),
      "Mixpanel endpoint must not contain dot segments",
    ],
    [
      "reserved body keys for export requests",
      () =>
        exportMixpanelEvents({
          credentials,
          options: {
            body: {
              project_id: "other-project",
            },
            bodyFormat: "json",
            method: "POST",
          },
        }),
      'Mixpanel body key "project_id" is reserved',
    ],
  ])("rejects %s", async (_label, invoke, message) => {
    await expect(invoke()).rejects.toThrow(message);
  });
});
