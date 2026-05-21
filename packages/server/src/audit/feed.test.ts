import { create, toBinary } from "@bufbuild/protobuf";
import { organization, workflowJournal } from "@onequery/db/server";
import { test as it } from "@onequery/db/testing/setup";
import {
  QueryActionEventPayloadSchema,
  QueryActionMode,
  QueryActionReceivedEventSchema,
} from "@onequery/proto-workflow/workflow/v1/query_action_pb";
import { describe, expect } from "vitest";

import {
  AuditFeedProjectionCorruptPayloadError,
  syncAuditFeedProjection,
} from "./feed";

function encodeQueryActionReceivedEventPayload() {
  return Buffer.from(
    toBinary(
      QueryActionEventPayloadSchema,
      create(QueryActionEventPayloadSchema, {
        event: {
          case: "actionReceived",
          value: create(QueryActionReceivedEventSchema, {
            queryMode: QueryActionMode.EXECUTE,
            queryText: "select * from sensitive_table",
          }),
        },
      })
    )
  );
}

describe("audit feed projection", { timeout: 60_000 }, () => {
  it("reports corrupt workflow payloads with scoped projection diagnostics", async ({
    db,
  }) => {
    const actionId = "query_action_corrupt_payload";
    const commandId = "workflow_command_corrupt_payload";
    const eventId = "query_action_event_corrupt_payload";
    const rawCommandBody = "sensitive command bytes";

    await db.insert(organization).values({
      id: "org_audit_feed_corrupt_payload",
      name: "Audit Feed Test",
      slug: "audit-feed-test",
    });
    const commitId = "workflow_commit_corrupt_payload";
    await db.insert(workflowJournal).values({
      actorSnapshotJson: {
        authMode: "api_key",
        email: "owner@example.com",
        membershipRoles: ["owner"],
        userId: "user_audit_feed_test",
      },
      causedByEventId: null,
      commandInvocationId: "query_action_corrupt_payload:start_execute",
      commitId,
      entryKind: "command",
      family: "query_action",
      id: commandId,
      occurredAt: new Date("2026-04-26T00:00:00.000Z"),
      organizationId: "org_audit_feed_corrupt_payload",
      payloadBytes: Buffer.concat([
        Buffer.from([0xff]),
        Buffer.from(rawCommandBody),
      ]),
      payloadType: "start_execute",
      requestId: "request_audit_feed_corrupt_payload",
      streamId: actionId,
      streamPosition: 1,
      surface: "cli",
    });
    await db.insert(workflowJournal).values({
      commitId,
      entryKind: "event",
      eventType: "action_received",
      eventId,
      family: "query_action",
      id: eventId,
      occurredAt: new Date("2026-04-26T00:00:00.000Z"),
      organizationId: "org_audit_feed_corrupt_payload",
      payloadBytes: encodeQueryActionReceivedEventPayload(),
      payloadType: "action_received",
      streamId: actionId,
      streamPosition: 2,
    });

    let error: unknown;
    try {
      await syncAuditFeedProjection(db);
    } catch (cause: unknown) {
      error = cause;
    }

    expect(error).toBeInstanceOf(AuditFeedProjectionCorruptPayloadError);
    if (!(error instanceof AuditFeedProjectionCorruptPayloadError)) {
      throw error ?? new Error("expected corrupt payload error");
    }
    expect(error).toMatchObject({
      actionId,
      commandId,
      entity: "query_action_command_payload",
      eventId,
      family: "query_action",
      payloadType: "start_execute",
    });
    expect(error.message).toContain("family=query_action");
    expect(error.message).toContain(
      "commandId=workflow_command_corrupt_payload"
    );
    expect(error.message).toContain("actionId=query_action_corrupt_payload");
    expect(error.message).toContain("payloadType=start_execute");
    expect(error.message).not.toContain(rawCommandBody);
  });

  it("does not advance unrelated audit families when a family filter is provided", async ({
    db,
  }) => {
    const actionId = "source_api_action_corrupt_payload";
    const commandId = "source_api_command_corrupt_payload";
    const eventId = "source_api_event_corrupt_payload";
    const commitId = "source_api_commit_corrupt_payload";

    await db.insert(organization).values({
      id: "org_audit_feed_family_filter",
      name: "Audit Feed Family Filter Test",
      slug: "audit-feed-family-filter-test",
    });
    await db.insert(workflowJournal).values({
      actorSnapshotJson: {
        authMode: "api_key",
        email: "owner@example.com",
        membershipRoles: ["owner"],
        userId: "user_audit_feed_family_filter",
      },
      causedByEventId: null,
      commandInvocationId: `${actionId}:start_describe`,
      commitId,
      entryKind: "command",
      family: "source_api_action",
      id: commandId,
      occurredAt: new Date("2026-04-26T01:00:00.000Z"),
      organizationId: "org_audit_feed_family_filter",
      payloadBytes: Buffer.from([0xff]),
      payloadType: "start_describe",
      requestId: "request_audit_feed_family_filter",
      streamId: actionId,
      streamPosition: 1,
      surface: "cli",
    });
    await db.insert(workflowJournal).values({
      commitId,
      entryKind: "event",
      eventId,
      eventType: "action_received",
      family: "source_api_action",
      id: eventId,
      occurredAt: new Date("2026-04-26T01:00:00.000Z"),
      organizationId: "org_audit_feed_family_filter",
      payloadBytes: Buffer.from([0xff]),
      payloadType: "action_received",
      streamId: actionId,
      streamPosition: 2,
    });

    await expect(
      syncAuditFeedProjection(db, { family: "query_action" })
    ).resolves.toBeUndefined();
    await expect(
      syncAuditFeedProjection(db, { family: "source_api_action" })
    ).rejects.toBeInstanceOf(AuditFeedProjectionCorruptPayloadError);
  });
});
