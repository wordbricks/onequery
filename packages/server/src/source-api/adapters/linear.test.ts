import type { LinearCredentials } from "@onequery/db/server";
import { describe, expect, it } from "vitest";

import type { PreparedSourceConnection, SourceApiActorContext } from "../types";
import { linearSourceApiAdapter } from "./linear";

const actor: SourceApiActorContext = {
  capabilities: ["source_api.describe"],
  membershipRoles: ["owner"],
  organizationId: "org_1",
  organizationSlug: "acme",
  userId: "user_1",
};

function createSource(
  accessMode: LinearCredentials["accessMode"]
): PreparedSourceConnection {
  return {
    credentials: {
      accessMode,
      accessToken: "lin_oauth_token",
      linearOrganizationId: "linear-org",
      type: "linear",
    },
    displayName: "Linear Workspace",
    id: "source_1",
    provider: "linear",
    sourceKey: "linear-workspace",
  };
}

describe("linear source api adapter", () => {
  it("disables source API operations for mention-only connections", async () => {
    const descriptor = await linearSourceApiAdapter.describe({
      actor,
      source: createSource("mention"),
    });

    expect(descriptor.defaultPathOperation).toBeUndefined();
    expect(descriptor.operations).toEqual([]);
  });

  it("exposes read operations for read-only connections", async () => {
    const descriptor = await linearSourceApiAdapter.describe({
      actor,
      source: createSource("read"),
    });

    expect(descriptor.operations.map((operation) => operation.name)).toEqual([
      "list_teams",
      "list_issues",
      "get_issue",
    ]);
  });

  it("adds create_issue for read-write connections", async () => {
    const descriptor = await linearSourceApiAdapter.describe({
      actor,
      source: createSource("read_write"),
    });

    expect(descriptor.operations.map((operation) => operation.name)).toEqual([
      "list_teams",
      "list_issues",
      "get_issue",
      "create_issue",
    ]);
  });
});
