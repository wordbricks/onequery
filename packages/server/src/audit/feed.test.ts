import { create, toBinary } from "@bufbuild/protobuf";
import {
  QueryActionEventPayloadSchema,
  QueryActionMode,
  QueryActionReceivedEventSchema,
} from "@onequery/contracts/workflow/v1/query_action_pb";
import {
  createDatabaseRuntime,
  organization,
  queryActionEvents,
  workflowCommands,
} from "@onequery/db/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  closeDatabase,
  createPgliteDatabaseUrl,
} from "../test/integration-helpers";
import type { ClosableDatabase } from "../test/integration-helpers";
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

describe("audit feed projection", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("reports corrupt workflow payloads with scoped projection diagnostics", async () => {
    const runtime = createDatabaseRuntime(
      await createPgliteDatabaseUrl("onequery-audit-feed-test-")
    );
    openedDatabases.push(runtime.db as ClosableDatabase);

    const actionId = "query_action_corrupt_payload";
    const commandId = "workflow_command_corrupt_payload";
    const eventId = "query_action_event_corrupt_payload";
    const rawCommandBody = "sensitive command bytes";

    await runtime.db.insert(organization).values({
      id: "org_audit_feed_corrupt_payload",
      name: "Audit Feed Test",
      slug: "audit-feed-test",
    });
    await runtime.db.insert(workflowCommands).values({
      actionId,
      actorSnapshotJson: {
        authMode: "api_key",
        email: "owner@example.com",
        membershipRoles: ["owner"],
        userId: "user_audit_feed_test",
      },
      causedByEventId: null,
      commandInvocationId: "query_action_corrupt_payload:start_execute",
      commandPayloadBytes: Buffer.concat([
        Buffer.from([0xff]),
        Buffer.from(rawCommandBody),
      ]),
      commandType: "start_execute",
      createdAt: new Date("2026-04-26T00:00:00.000Z"),
      decisionKind: "accepted",
      family: "query_action",
      id: commandId,
      organizationId: "org_audit_feed_corrupt_payload",
      requestId: "request_audit_feed_corrupt_payload",
      surface: "cli",
    });
    await runtime.db.insert(queryActionEvents).values({
      actionId,
      commandId,
      eventType: "action_received",
      id: eventId,
      occurredAt: new Date("2026-04-26T00:00:00.000Z"),
      payloadBytes: encodeQueryActionReceivedEventPayload(),
      sequence: 1,
    });

    let error: unknown;
    try {
      await syncAuditFeedProjection(runtime.db);
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
});
