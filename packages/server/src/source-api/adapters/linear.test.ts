import type { LinearCredentials } from "@onequery/db/server";
import { describe, expect, it, vi } from "vitest";

import type { PreparedSourceConnection, SourceApiActorContext } from "../types";
import { linearSourceApiAdapter, requestLinearGraphQl } from "./linear";

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
    credentials: createLinearCredentials(accessMode),
    displayName: "Linear Workspace",
    id: "source_1",
    provider: "linear",
    sourceKey: "linear-workspace",
  };
}

function createLinearCredentials(
  accessMode: LinearCredentials["accessMode"]
): LinearCredentials {
  return {
    accessMode,
    accessToken: "lin_oauth_token",
    linearOrganizationId: "linear-org",
    type: "linear",
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
      "list_workflow_states",
      "list_issues",
      "get_issue",
    ]);
  });

  it("adds issue write operations for read-write connections", async () => {
    const descriptor = await linearSourceApiAdapter.describe({
      actor,
      source: createSource("read_write"),
    });

    expect(descriptor.operations.map((operation) => operation.name)).toEqual([
      "list_teams",
      "list_workflow_states",
      "list_issues",
      "get_issue",
      "create_issue",
      "create_comment",
      "update_issue",
    ]);
  });

  it("normalizes list_workflow_states field patches into a team states query", async () => {
    const source = createSource("read");
    const descriptor = await linearSourceApiAdapter.describe({
      actor,
      source,
    });

    const prepared = await linearSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "none" },
        fieldPatch: { teamId: "team_123" },
        headers: [],
        operation: "list_workflow_states",
      },
      source,
    });

    if (prepared.kind !== "structured_request") {
      throw new Error(`expected structured request, got ${prepared.kind}`);
    }

    expect(prepared.request.query).toContain("VelenLinearWorkflowStates");
    expect(prepared.request.query).toContain("states(first: 100)");
    expect(prepared.request.variables).toEqual({ id: "team_123" });
  });

  it("rejects list_workflow_states without a team id", async () => {
    const source = createSource("read");
    const descriptor = await linearSourceApiAdapter.describe({
      actor,
      source,
    });

    await expect(
      linearSourceApiAdapter.normalize({
        actor,
        descriptor,
        request: {
          body: { kind: "none" },
          fieldPatch: {},
          headers: [],
          operation: "list_workflow_states",
        },
        source,
      })
    ).rejects.toThrow("Invalid Linear list_workflow_states fieldPatch input");
  });

  it("normalizes create_comment field patches into a Linear GraphQL mutation", async () => {
    const source = createSource("read_write");
    const descriptor = await linearSourceApiAdapter.describe({
      actor,
      source,
    });

    const prepared = await linearSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "none" },
        fieldPatch: {
          body: "Investigation started.",
          issueId: "issue_123",
        },
        headers: [],
        operation: "create_comment",
      },
      source,
    });

    if (prepared.kind !== "structured_request") {
      throw new Error(`expected structured request, got ${prepared.kind}`);
    }

    expect(prepared.request.query).toContain("commentCreate");
    expect(prepared.request.variables).toEqual({
      input: {
        body: "Investigation started.",
        issueId: "issue_123",
      },
    });
  });

  it("normalizes update_issue field patches into a Linear state update mutation", async () => {
    const source = createSource("read_write");
    const descriptor = await linearSourceApiAdapter.describe({
      actor,
      source,
    });

    const prepared = await linearSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "none" },
        fieldPatch: {
          issueId: "issue_123",
          stateId: "state_456",
        },
        headers: [],
        operation: "update_issue",
      },
      source,
    });

    if (prepared.kind !== "structured_request") {
      throw new Error(`expected structured request, got ${prepared.kind}`);
    }

    expect(prepared.request.query).toContain("issueUpdate");
    expect(prepared.request.variables).toEqual({
      id: "issue_123",
      input: { stateId: "state_456" },
    });
  });

  it("rejects update_issue without a state id", async () => {
    const source = createSource("read_write");
    const descriptor = await linearSourceApiAdapter.describe({
      actor,
      source,
    });

    await expect(
      linearSourceApiAdapter.normalize({
        actor,
        descriptor,
        request: {
          body: { kind: "none" },
          fieldPatch: { issueId: "issue_123" },
          headers: [],
          operation: "update_issue",
        },
        source,
      })
    ).rejects.toThrow("Invalid Linear update_issue fieldPatch input");
  });

  it("requests temporary signed URLs for private Linear files", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            issue: {
              description:
                "![screenshot](https://uploads.linear.app/file?signed=true)",
            },
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      )
    );
    await requestLinearGraphQl({
      credentials: createLinearCredentials("read"),
      fetchImpl: fetchMock as unknown as typeof fetch,
      request: {
        query:
          'query VelenLinearIssue { issue(id: "ENG-123") { description } }',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer lin_oauth_token",
      "Content-Type": "application/json",
      "public-file-urls-expire-in": "300",
    });
  });
});
