import type { LinearCredentials } from "@onequery/db/server";
import { describe, expect, it, vi } from "vitest";

import type { PreparedSourceConnection, SourceApiActorContext } from "../types";
import {
  createLinearSourceApiAdapter,
  linearSourceApiAdapter,
  requestLinearGraphQl,
} from "./linear";

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

  it("adds issue, comment, and image upload writes for read-write connections", async () => {
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
      "create_comment_with_image",
    ]);

    const uploadOperation = descriptor.operations.find(
      (operation) => operation.name === "create_comment_with_image"
    );
    expect(uploadOperation).toMatchObject({
      fieldPolicy: {
        acceptsInput: true,
        allowsRawFields: false,
        allowsTypedFields: false,
        inputMode: "request_body",
      },
      selectorKind: "identifier",
    });
    expect(uploadOperation?.headerPolicy.allowedRequestHeaders).toEqual([
      "content-type",
      "x-onequery-alt-text",
      "x-onequery-comment-body",
      "x-onequery-file-name",
      "x-onequery-parent-id",
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

  it("normalizes a local image body without embedding bytes in structured metadata", async () => {
    const source = createSource("read_write");
    const descriptor = await linearSourceApiAdapter.describe({ actor, source });
    const image = new Uint8Array([137, 80, 78, 71]);

    const prepared = await linearSourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "binary", value: image },
        headers: [
          { name: "Content-Type", value: "image/png" },
          { name: "X-OneQuery-File-Name", value: "error.png" },
          { name: "X-OneQuery-Alt-Text", value: "Login error" },
          {
            name: "X-OneQuery-Comment-Body",
            value: "Captured from production.",
          },
        ],
        operation: "create_comment_with_image",
        selector: "issue_123",
      },
      source,
    });

    expect(prepared).toMatchObject({
      body: { kind: "binary", value: image },
      headers: [],
      kind: "structured_request",
      operation: "create_comment_with_image",
      request: {
        altText: "Login error",
        commentBody: "Captured from production.",
        contentType: "image/png",
        fileName: "error.png",
        issueId: "issue_123",
      },
      selector: "issue_123",
    });
  });

  it("uploads a local image through Linear fileUpload before creating the comment", async () => {
    const source = createSource("read_write");
    const descriptor = await linearSourceApiAdapter.describe({ actor, source });
    const image = new Uint8Array([137, 80, 78, 71]);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            fileUpload: {
              success: true,
              uploadFile: {
                assetUrl: "https://uploads.linear.app/asset/error.png",
                headers: [
                  { key: "x-amz-acl", value: "private" },
                  { key: "content-type", value: "image/png" },
                ],
                uploadUrl: "https://linear-uploads.example.com/presigned",
              },
            },
          },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          data: {
            commentCreate: {
              comment: {
                body: "Captured from production.\n\n![Login error](https://uploads.linear.app/asset/error.png)",
                id: "comment_123",
              },
              success: true,
            },
          },
        })
      );
    const adapter = createLinearSourceApiAdapter({ fetchImpl: fetchMock });

    const prepared = await adapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "binary", value: image },
        headers: [
          { name: "content-type", value: "image/png" },
          { name: "x-onequery-file-name", value: "error.png" },
          { name: "x-onequery-alt-text", value: "Login error" },
          {
            name: "x-onequery-comment-body",
            value: "Captured from production.",
          },
        ],
        operation: "create_comment_with_image",
        selector: "issue_123",
      },
      source,
    });
    const result = await adapter.execute({
      actor,
      prepared: {
        ...prepared,
        bodyKind: prepared.body.kind,
        bodyPaths: [],
        headerNames: [],
        preparedBinding: "binding",
      },
      source,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [fileUploadUrl, fileUploadInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(fileUploadUrl)).toBe("https://api.linear.app/graphql");
    expect(JSON.parse(String(fileUploadInit?.body))).toMatchObject({
      query: expect.stringContaining("fileUpload"),
      variables: {
        contentType: "image/png",
        filename: "error.png",
        size: 4,
      },
    });

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1] ?? [];
    expect(String(uploadUrl)).toBe(
      "https://linear-uploads.example.com/presigned"
    );
    expect(uploadInit?.method).toBe("PUT");
    expect(uploadInit?.body).toEqual(image);
    const uploadHeaders = new Headers(uploadInit?.headers);
    expect(uploadHeaders.get("content-type")).toBe("image/png");
    expect(uploadHeaders.get("cache-control")).toBe("public, max-age=31536000");
    expect(uploadHeaders.get("x-amz-acl")).toBe("private");

    const [, commentInit] = fetchMock.mock.calls[2] ?? [];
    expect(JSON.parse(String(commentInit?.body))).toMatchObject({
      query: expect.stringContaining("commentCreate"),
      variables: {
        input: {
          body: "Captured from production.\n\n![Login error](https://uploads.linear.app/asset/error.png)",
          issueId: "issue_123",
        },
      },
    });
    expect(result.body).toEqual({
      kind: "json",
      value: {
        data: {
          commentCreate: {
            comment: {
              body: "Captured from production.\n\n![Login error](https://uploads.linear.app/asset/error.png)",
              id: "comment_123",
            },
            success: true,
          },
        },
      },
    });
  });

  it("does not create a comment when the pre-signed image upload fails", async () => {
    const source = createSource("read_write");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            fileUpload: {
              success: true,
              uploadFile: {
                assetUrl: "https://uploads.linear.app/asset/error.png",
                headers: [],
                uploadUrl: "https://linear-uploads.example.com/presigned",
              },
            },
          },
        })
      )
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    const adapter = createLinearSourceApiAdapter({ fetchImpl: fetchMock });
    const descriptor = await adapter.describe({ actor, source });
    const prepared = await adapter.normalize({
      actor,
      descriptor,
      request: {
        body: { kind: "binary", value: new Uint8Array([137, 80, 78, 71]) },
        headers: [
          { name: "content-type", value: "image/png" },
          { name: "x-onequery-file-name", value: "error.png" },
        ],
        operation: "create_comment_with_image",
        selector: "issue_123",
      },
      source,
    });

    await expect(
      adapter.execute({
        actor,
        prepared: {
          ...prepared,
          bodyKind: prepared.body.kind,
          bodyPaths: [],
          headerNames: [],
          preparedBinding: "binding",
        },
        source,
      })
    ).rejects.toThrow("Linear file upload failed (403)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects non-image uploads before making a Linear request", async () => {
    const source = createSource("read_write");
    const descriptor = await linearSourceApiAdapter.describe({ actor, source });

    await expect(
      linearSourceApiAdapter.normalize({
        actor,
        descriptor,
        request: {
          body: { kind: "binary", value: new Uint8Array([1, 2, 3]) },
          headers: [
            { name: "content-type", value: "application/pdf" },
            { name: "x-onequery-file-name", value: "report.pdf" },
          ],
          operation: "create_comment_with_image",
          selector: "issue_123",
        },
        source,
      })
    ).rejects.toThrow("requires an image content type");
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
