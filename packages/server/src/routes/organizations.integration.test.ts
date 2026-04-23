import { auditListResponseSchema } from "@onequery/contracts/audit";
import {
  auditFeedEntries,
  auditProjectionCheckpoints,
  createDb,
  queryActionEvents,
  queryActions,
  sourceApiActionEvents,
  sourceApiActions,
  workflowCommands,
} from "@onequery/db/server";
import { describe, expect, it } from "vitest";

import {
  closeDatabase,
  createPgliteDatabaseUrl,
  createRouteIntegrationHarness,
  createRunId,
} from "../test/integration-helpers";
import type { ClosableDatabase } from "../test/integration-helpers";

type TestDatabase = ReturnType<typeof createDb>;

type WorkflowActorSnapshot = {
  authMode: string | null;
  email: string | null;
  membershipRoles: string[];
  userId: string | null;
};

const sourceDescriptor = {
  displayName: "Warehouse",
  name: "warehouse",
  organizationId: "org-placeholder",
  provider: "postgres",
  sourceId: "source-warehouse",
  sourceKey: "warehouse",
  sourceStatus: "active",
} as const;

const sourceApiDescriptor = {
  displayName: "Billing API",
  provider: "http",
  sourceId: "source-billing-api",
  sourceKey: "billing-api",
} as const;

const requestDescriptor = {
  descriptorVersion: "2026-04-20",
  kind: "http_request",
  method: "GET",
  operation: "listCustomers",
  paginationPolicy: "continuation_token",
  selector: "/customers",
} as const;

async function insertAcceptedWorkflowCommand(input: {
  actionId: string;
  actorSnapshot: WorkflowActorSnapshot;
  commandId: string;
  commandInvocationId: string;
  commandPayloadJson: Record<string, unknown>;
  commandType: string;
  createdAt: Date;
  db: TestDatabase;
  family: "query_action" | "source_api_action";
  organizationId: string;
  requestId: string;
  surface: "cli" | "web" | "agent" | "system";
}) {
  await input.db.insert(workflowCommands).values({
    actionId: input.actionId,
    actorSnapshotJson: input.actorSnapshot,
    causedByEventId: null,
    commandInvocationId: input.commandInvocationId,
    commandPayloadJson: input.commandPayloadJson,
    commandType: input.commandType,
    createdAt: input.createdAt,
    decisionKind: "accepted",
    family: input.family,
    id: input.commandId,
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: input.surface,
  });
}

async function seedSucceededQueryAction(input: {
  actionId: string;
  actorSnapshot: WorkflowActorSnapshot;
  commitPositionBase?: bigint;
  db: TestDatabase;
  organizationId: string;
  requestId: string;
  startedAt: Date;
}) {
  const actionId = input.actionId;
  const commitPositionBase = input.commitPositionBase ?? 0n;
  const eventBase = `${actionId}-event`;
  const commandBase = `${actionId}-command`;
  const source = {
    ...sourceDescriptor,
    organizationId: input.organizationId,
  };

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-start`,
    commandInvocationId: `${actionId}:start_execute`,
    commandPayloadJson: {
      queryText: "select * from customers",
      sourceKey: source.sourceKey,
      type: "start_execute",
    },
    commandType: "start_execute",
    createdAt: input.startedAt,
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "cli",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-source`,
    commandInvocationId: `${actionId}:record_source_lookup`,
    commandPayloadJson: {
      kind: "found",
      source,
      type: "record_source_lookup",
    },
    commandType: "record_source_lookup",
    createdAt: new Date(input.startedAt.getTime() + 1_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-validated`,
    commandInvocationId: `${actionId}:record_query_validation`,
    commandPayloadJson: {
      kind: "accepted",
      type: "record_query_validation",
      validatedQuery: "select * from customers",
    },
    commandType: "record_query_validation",
    createdAt: new Date(input.startedAt.getTime() + 2_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-credentials`,
    commandInvocationId: `${actionId}:record_credentials_load`,
    commandPayloadJson: {
      kind: "loaded",
      type: "record_credentials_load",
    },
    commandType: "record_credentials_load",
    createdAt: new Date(input.startedAt.getTime() + 3_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-executed`,
    commandInvocationId: `${actionId}:record_query_execution`,
    commandPayloadJson: {
      kind: "succeeded",
      response: {
        columns: [],
        elapsedMs: 412,
        rowCount: 12,
        rows: [],
        source: {
          displayName: source.displayName,
          id: source.sourceId,
          provider: source.provider,
          sourceKey: source.sourceKey,
          status: source.sourceStatus,
        },
        truncated: false,
      },
      type: "record_query_execution",
    },
    commandType: "record_query_execution",
    createdAt: new Date(input.startedAt.getTime() + 4_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-usage`,
    commandInvocationId: `${actionId}:record_usage_persistence`,
    commandPayloadJson: {
      kind: "succeeded",
      type: "record_usage_persistence",
    },
    commandType: "record_usage_persistence",
    createdAt: new Date(input.startedAt.getTime() + 5_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await input.db.insert(queryActions).values({
    completedAt: new Date(input.startedAt.getTime() + 5_000),
    failureCode: null,
    id: actionId,
    lastEventId: `${eventBase}-usage`,
    lastEventSequence: 6,
    organizationId: input.organizationId,
    outcome: "succeeded",
    phase: "completed",
    queryMode: "execute",
    queryText: "select * from customers",
    sourceDescriptorJson: source,
    startedAt: input.startedAt,
    usageRecordingStatus: "succeeded",
    validatedQuery: "select * from customers",
  });

  await input.db.insert(queryActionEvents).values([
    {
      actionId,
      commandId: `${commandBase}-start`,
      commitPosition: commitPositionBase + 1n,
      eventType: "action_received",
      id: `${eventBase}-start`,
      occurredAt: input.startedAt,
      payloadJson: {
        queryMode: "execute",
        queryText: "select * from customers",
        type: "action_received",
      },
      sequence: 1,
    },
    {
      actionId,
      commandId: `${commandBase}-source`,
      commitPosition: commitPositionBase + 2n,
      eventType: "source_loaded",
      id: `${eventBase}-source`,
      occurredAt: new Date(input.startedAt.getTime() + 1_000),
      payloadJson: {
        source,
        type: "source_loaded",
      },
      sequence: 2,
    },
    {
      actionId,
      commandId: `${commandBase}-validated`,
      commitPosition: commitPositionBase + 3n,
      eventType: "query_validated",
      id: `${eventBase}-validated`,
      occurredAt: new Date(input.startedAt.getTime() + 2_000),
      payloadJson: {
        type: "query_validated",
        validatedQuery: "select * from customers",
      },
      sequence: 3,
    },
    {
      actionId,
      commandId: `${commandBase}-credentials`,
      commitPosition: commitPositionBase + 4n,
      eventType: "credentials_loaded",
      id: `${eventBase}-credentials`,
      occurredAt: new Date(input.startedAt.getTime() + 3_000),
      payloadJson: {
        type: "credentials_loaded",
      },
      sequence: 4,
    },
    {
      actionId,
      commandId: `${commandBase}-executed`,
      commitPosition: commitPositionBase + 5n,
      eventType: "query_executed",
      id: `${eventBase}-executed`,
      occurredAt: new Date(input.startedAt.getTime() + 4_000),
      payloadJson: {
        elapsedMs: 412,
        rowCount: 12,
        type: "query_executed",
      },
      sequence: 5,
    },
    {
      actionId,
      commandId: `${commandBase}-usage`,
      commitPosition: commitPositionBase + 6n,
      eventType: "usage_persisted",
      id: `${eventBase}-usage`,
      occurredAt: new Date(input.startedAt.getTime() + 5_000),
      payloadJson: {
        type: "usage_persisted",
      },
      sequence: 6,
    },
  ]);
}

async function seedRejectedQueryAction(input: {
  actionId: string;
  actorSnapshot: WorkflowActorSnapshot;
  db: TestDatabase;
  organizationId: string;
  requestId: string;
  startedAt: Date;
}) {
  const actionId = input.actionId;
  const eventBase = `${actionId}-event`;
  const commandBase = `${actionId}-command`;
  const source = {
    ...sourceDescriptor,
    displayName: "Billing Warehouse",
    name: "billing",
    organizationId: input.organizationId,
    sourceId: "source-billing",
    sourceKey: "billing",
  };

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-start`,
    commandInvocationId: `${actionId}:start_validate`,
    commandPayloadJson: {
      queryText: "delete from rejected_accounts",
      sourceKey: source.sourceKey,
      type: "start_validate",
    },
    commandType: "start_validate",
    createdAt: input.startedAt,
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "cli",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-source`,
    commandInvocationId: `${actionId}:record_source_lookup`,
    commandPayloadJson: {
      kind: "found",
      source,
      type: "record_source_lookup",
    },
    commandType: "record_source_lookup",
    createdAt: new Date(input.startedAt.getTime() + 1_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-rejected`,
    commandInvocationId: `${actionId}:record_query_validation`,
    commandPayloadJson: {
      detail: "unsafe mutation",
      hint: "remove write statements",
      kind: "rejected",
      type: "record_query_validation",
    },
    commandType: "record_query_validation",
    createdAt: new Date(input.startedAt.getTime() + 2_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await input.db.insert(queryActions).values({
    completedAt: new Date(input.startedAt.getTime() + 2_000),
    failureCode: "query_rejected",
    id: actionId,
    lastEventId: `${eventBase}-rejected`,
    lastEventSequence: 3,
    organizationId: input.organizationId,
    outcome: "failed",
    phase: "completed",
    queryMode: "validate",
    queryText: "delete from rejected_accounts",
    sourceDescriptorJson: source,
    startedAt: input.startedAt,
    usageRecordingStatus: "not_started",
    validatedQuery: null,
  });

  await input.db.insert(queryActionEvents).values([
    {
      actionId,
      commandId: `${commandBase}-start`,
      commitPosition: 7n,
      eventType: "action_received",
      id: `${eventBase}-start`,
      occurredAt: input.startedAt,
      payloadJson: {
        queryMode: "validate",
        queryText: "delete from rejected_accounts",
        type: "action_received",
      },
      sequence: 1,
    },
    {
      actionId,
      commandId: `${commandBase}-source`,
      commitPosition: 8n,
      eventType: "source_loaded",
      id: `${eventBase}-source`,
      occurredAt: new Date(input.startedAt.getTime() + 1_000),
      payloadJson: {
        source,
        type: "source_loaded",
      },
      sequence: 2,
    },
    {
      actionId,
      commandId: `${commandBase}-rejected`,
      commitPosition: 9n,
      eventType: "query_rejected",
      id: `${eventBase}-rejected`,
      occurredAt: new Date(input.startedAt.getTime() + 2_000),
      payloadJson: {
        detail: "unsafe mutation",
        hint: "remove write statements",
        type: "query_rejected",
      },
      sequence: 3,
    },
  ]);
}

async function seedPendingSourceApiAction(input: {
  actionId: string;
  actorSnapshot: WorkflowActorSnapshot;
  db: TestDatabase;
  organizationId: string;
  requestId: string;
  startedAt: Date;
}) {
  const actionId = input.actionId;
  const eventBase = `${actionId}-event`;
  const commandBase = `${actionId}-command`;

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-start`,
    commandInvocationId: `${actionId}:start_invoke`,
    commandPayloadJson: {
      invokeMode: "execute",
      requestDescriptor,
      sourceKey: sourceApiDescriptor.sourceKey,
      type: "start_invoke",
    },
    commandType: "start_invoke",
    createdAt: input.startedAt,
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "web",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-source`,
    commandInvocationId: `${actionId}:record_source_lookup`,
    commandPayloadJson: {
      kind: "found",
      source: sourceApiDescriptor,
      type: "record_source_lookup",
    },
    commandType: "record_source_lookup",
    createdAt: new Date(input.startedAt.getTime() + 1_000),
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-descriptor`,
    commandInvocationId: `${actionId}:record_descriptor_resolution`,
    commandPayloadJson: {
      kind: "resolved",
      requestDescriptor,
      type: "record_descriptor_resolution",
    },
    commandType: "record_descriptor_resolution",
    createdAt: new Date(input.startedAt.getTime() + 2_000),
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-prepared`,
    commandInvocationId: `${actionId}:record_request_preparation`,
    commandPayloadJson: {
      kind: "prepared",
      preparedRequestFingerprint: "billing-api:customers:v1",
      type: "record_request_preparation",
    },
    commandType: "record_request_preparation",
    createdAt: new Date(input.startedAt.getTime() + 3_000),
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-fetch`,
    commandInvocationId: `${actionId}:record_page_fetch`,
    commandPayloadJson: {
      attemptNumber: 1,
      detail: "429 rate limited by upstream",
      kind: "retryable_failure",
      pageIndex: 0,
      type: "record_page_fetch",
    },
    commandType: "record_page_fetch",
    createdAt: new Date("2026-03-27T11:00:00.000Z"),
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await input.db.insert(sourceApiActions).values({
    attemptNumber: 1,
    completedAt: null,
    failureCode: null,
    id: actionId,
    invokeMode: "execute",
    lastEventId: `${eventBase}-fetch`,
    lastEventSequence: 5,
    organizationId: input.organizationId,
    outcome: "pending",
    pageProgressJson: {
      nextPageIndex: 0,
    },
    phase: "await_resume",
    preparedRequestFingerprint: "billing-api:customers:v1",
    requestDescriptorJson: requestDescriptor,
    requestKind: "invoke",
    sourceDescriptorJson: sourceApiDescriptor,
    startedAt: input.startedAt,
  });

  await input.db.insert(sourceApiActionEvents).values([
    {
      actionId,
      commandId: `${commandBase}-start`,
      commitPosition: 1n,
      eventType: "action_received",
      id: `${eventBase}-start`,
      occurredAt: input.startedAt,
      payloadJson: {
        invokeMode: "execute",
        requestDescriptor,
        requestKind: "invoke",
        type: "action_received",
      },
      sequence: 1,
    },
    {
      actionId,
      commandId: `${commandBase}-source`,
      commitPosition: 2n,
      eventType: "source_loaded",
      id: `${eventBase}-source`,
      occurredAt: new Date(input.startedAt.getTime() + 1_000),
      payloadJson: {
        source: sourceApiDescriptor,
        type: "source_loaded",
      },
      sequence: 2,
    },
    {
      actionId,
      commandId: `${commandBase}-descriptor`,
      commitPosition: 3n,
      eventType: "descriptor_resolved",
      id: `${eventBase}-descriptor`,
      occurredAt: new Date(input.startedAt.getTime() + 2_000),
      payloadJson: {
        requestDescriptor,
        type: "descriptor_resolved",
      },
      sequence: 3,
    },
    {
      actionId,
      commandId: `${commandBase}-prepared`,
      commitPosition: 4n,
      eventType: "request_prepared",
      id: `${eventBase}-prepared`,
      occurredAt: new Date(input.startedAt.getTime() + 3_000),
      payloadJson: {
        preparedRequestFingerprint: "billing-api:customers:v1",
        type: "request_prepared",
      },
      sequence: 4,
    },
    {
      actionId,
      commandId: `${commandBase}-fetch`,
      commitPosition: 5n,
      eventType: "page_fetch_failed",
      id: `${eventBase}-fetch`,
      occurredAt: new Date("2026-03-27T11:00:00.000Z"),
      payloadJson: {
        attemptNumber: 1,
        detail: "429 rate limited by upstream",
        failureCode: null,
        kind: "retryable_failure",
        pageIndex: 0,
        type: "page_fetch_failed",
      },
      sequence: 5,
    },
  ]);
}

describe("organizations audit route", () => {
  it("projects mixed-family actions, paginates by startedAt, filters on projection fields, and rebuilds after truncation", async () => {
    const harness = await createRouteIntegrationHarness({
      databaseUrl: await createPgliteDatabaseUrl("onequery-org-audit-"),
    });

    expect(harness.isOk()).toBe(true);
    if (harness.isErr()) {
      return;
    }

    const { client, db, test } = harness.value;

    const runId = createRunId();
    const owner = test.createUser({
      email: `audit-owner-${runId}@example.com`,
    });
    const organization = test.createOrganization({
      name: `Audit Route ${runId}`,
      slug: `audit-route-${runId}`,
    });

    await test.saveUser(owner);

    try {
      await test.saveOrganization(organization);
      await test.addMember({
        organizationId: organization.id as string,
        role: "owner",
        userId: owner.id,
      });

      const ownerLogin = await test.login({ userId: owner.id });
      const ownerCookie = ownerLogin.headers.get("cookie");

      if (!ownerCookie) {
        throw new Error("Owner login must expose a cookie header");
      }

      const actorSnapshot: WorkflowActorSnapshot = {
        authMode: "browser_session",
        email: owner.email,
        membershipRoles: ["owner"],
        userId: owner.id,
      };

      await seedSucceededQueryAction({
        actionId: `query-success-${runId}`,
        actorSnapshot,
        db,
        organizationId: organization.id as string,
        requestId: `req-query-success-${runId}`,
        startedAt: new Date("2026-03-27T10:00:00.000Z"),
      });

      await seedRejectedQueryAction({
        actionId: `query-rejected-${runId}`,
        actorSnapshot,
        db,
        organizationId: organization.id as string,
        requestId: `req-query-rejected-${runId}`,
        startedAt: new Date("2026-03-27T09:00:00.000Z"),
      });

      await seedPendingSourceApiAction({
        actionId: `source-api-pending-${runId}`,
        actorSnapshot,
        db,
        organizationId: organization.id as string,
        requestId: `req-source-api-${runId}`,
        startedAt: new Date("2026-03-27T09:30:00.000Z"),
      });

      const firstPageResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            limit: "1",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(firstPageResponse.status).toBe(200);

      const firstPage = auditListResponseSchema.parse(
        await firstPageResponse.json()
      );
      const firstItem = firstPage.items[0];

      expect(firstPage.projectionLag).toEqual({
        queryAction: false,
        sourceApiAction: false,
      });
      expect(firstPage.projectedThrough.queryAction).not.toBeNull();
      expect(firstPage.projectedThrough.sourceApiAction).not.toBeNull();
      expect(firstPage.items).toHaveLength(1);
      expect(firstItem).toBeDefined();
      if (!firstItem || !firstItem.preview) {
        throw new Error("first audit page must include a preview");
      }
      expect(firstItem).toMatchObject({
        actionName: "execute",
        family: "query_action",
        familyActionId: `query-success-${runId}`,
        id: `query_action:query-success-${runId}`,
        outcome: "succeeded",
        startedAt: "2026-03-27T10:00:00.000Z",
      });
      expect(firstItem.preview).toMatchObject({
        elapsedMs: 412,
        queryText: "select * from customers",
        rowCount: 12,
        usageRecordingStatus: "succeeded",
        validatedQuery: "select * from customers",
      });
      expect(firstItem.preview).not.toHaveProperty("errorDetail");
      expect(firstItem.preview).not.toHaveProperty("errorHint");
      expect(firstPage.families).toEqual(["query_action"]);
      expect(firstPage.nextCursor).not.toBeNull();

      const secondPageResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            cursor: firstPage.nextCursor ?? "",
            limit: "1",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(secondPageResponse.status).toBe(200);

      const secondPage = auditListResponseSchema.parse(
        await secondPageResponse.json()
      );
      const secondItem = secondPage.items[0];

      expect(secondPage.items).toHaveLength(1);
      expect(secondItem).toBeDefined();
      if (!secondItem || !secondItem.preview) {
        throw new Error("second audit page must include a preview");
      }
      expect(secondItem).toMatchObject({
        actionName: "invoke",
        family: "source_api_action",
        familyActionId: `source-api-pending-${runId}`,
        id: `source_api_action:source-api-pending-${runId}`,
        lastEventAt: "2026-03-27T11:00:00.000Z",
        outcome: "pending",
        startedAt: "2026-03-27T09:30:00.000Z",
      });
      expect(secondItem.preview).toMatchObject({
        attemptNumber: 1,
        httpStatus: null,
        invokeMode: "execute",
        method: "GET",
        operation: "listCustomers",
        pageCount: 1,
        selector: "/customers",
      });
      expect(secondItem.preview).not.toHaveProperty("errorDetail");
      expect(secondItem.preview).not.toHaveProperty("responseBytes");
      expect(secondPage.nextCursor).not.toBeNull();

      const filteredResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            family: "source_api_action",
            outcome: "pending",
            q: "customers",
            sourceKey: "billing-api",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(filteredResponse.status).toBe(200);

      const filtered = auditListResponseSchema.parse(
        await filteredResponse.json()
      );

      expect(filtered.items).toHaveLength(1);
      expect(filtered.items[0]).toMatchObject({
        family: "source_api_action",
        familyActionId: `source-api-pending-${runId}`,
        id: `source_api_action:source-api-pending-${runId}`,
        outcome: "pending",
        target: {
          sourceKey: "billing-api",
        },
      });

      const sanitizedActionResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            actionName: "execute",
            family: "source_api_action",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(sanitizedActionResponse.status).toBe(200);

      const sanitizedActionPage = auditListResponseSchema.parse(
        await sanitizedActionResponse.json()
      );

      expect(sanitizedActionPage.items).toHaveLength(1);
      expect(sanitizedActionPage.items[0]).toMatchObject({
        actionName: "invoke",
        family: "source_api_action",
        familyActionId: `source-api-pending-${runId}`,
      });

      const hiddenHintResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            q: "remove write statements",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(hiddenHintResponse.status).toBe(200);

      const hiddenHintPage = auditListResponseSchema.parse(
        await hiddenHintResponse.json()
      );

      expect(hiddenHintPage.items).toHaveLength(0);

      await db.delete(auditFeedEntries);
      await db.delete(auditProjectionCheckpoints);

      const rebuiltResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            limit: "3",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(rebuiltResponse.status).toBe(200);

      const rebuilt = auditListResponseSchema.parse(
        await rebuiltResponse.json()
      );

      expect(rebuilt.items.map((item) => item.id)).toEqual([
        `query_action:query-success-${runId}`,
        `source_api_action:source-api-pending-${runId}`,
        `query_action:query-rejected-${runId}`,
      ]);
    } finally {
      await closeDatabase(db as ClosableDatabase);
    }
  });

  it("rejects unauthenticated and unauthorized audit reads and returns 404 for unknown orgs", async () => {
    const harness = await createRouteIntegrationHarness({
      databaseUrl: await createPgliteDatabaseUrl("onequery-org-audit-access-"),
    });

    expect(harness.isOk()).toBe(true);
    if (harness.isErr()) {
      return;
    }

    const { client, db, test } = harness.value;

    const runId = createRunId();
    const owner = test.createUser({
      email: `audit-access-owner-${runId}@example.com`,
    });
    const outsider = test.createUser({
      email: `audit-access-outsider-${runId}@example.com`,
    });
    const organization = test.createOrganization({
      name: `Audit Access ${runId}`,
      slug: `audit-access-${runId}`,
    });

    await test.saveUser(owner);
    await test.saveUser(outsider);

    try {
      await test.saveOrganization(organization);
      await test.addMember({
        organizationId: organization.id as string,
        role: "owner",
        userId: owner.id,
      });

      const outsiderLogin = await test.login({ userId: outsider.id });
      const outsiderCookie = outsiderLogin.headers.get("cookie");

      if (!outsiderCookie) {
        throw new Error("Outsider login must expose a cookie header");
      }

      const unauthenticated = await client.api.organizations[
        ":slug"
      ].audit.$get({
        param: {
          slug: organization.slug as string,
        },
        query: {},
      });
      expect(unauthenticated.status).toBe(401);

      const forbidden = await client.api.organizations[":slug"].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {},
        },
        {
          headers: { cookie: outsiderCookie },
        }
      );
      expect(forbidden.status).toBe(403);

      const ownerLogin = await test.login({ userId: owner.id });
      const ownerCookie = ownerLogin.headers.get("cookie");

      if (!ownerCookie) {
        throw new Error("Owner login must expose a cookie header");
      }

      const missing = await client.api.organizations[":slug"].audit.$get(
        {
          param: {
            slug: "missing-org",
          },
          query: {},
        },
        {
          headers: { cookie: ownerCookie },
        }
      );
      expect(missing.status).toBe(404);
    } finally {
      await closeDatabase(db as ClosableDatabase);
    }
  });

  it("reports when the audit projection is still behind the event log", async () => {
    const harness = await createRouteIntegrationHarness({
      databaseUrl: await createPgliteDatabaseUrl("onequery-org-audit-lag-"),
    });

    expect(harness.isOk()).toBe(true);
    if (harness.isErr()) {
      return;
    }

    const { client, db, test } = harness.value;
    const runId = createRunId();
    const owner = test.createUser({
      email: `audit-lag-owner-${runId}@example.com`,
    });
    const organization = test.createOrganization({
      name: `Audit Lag ${runId}`,
      slug: `audit-lag-${runId}`,
    });

    await test.saveUser(owner);

    try {
      await test.saveOrganization(organization);
      await test.addMember({
        organizationId: organization.id as string,
        role: "owner",
        userId: owner.id,
      });

      const ownerLogin = await test.login({ userId: owner.id });
      const ownerCookie = ownerLogin.headers.get("cookie");

      if (!ownerCookie) {
        throw new Error("Owner login must expose a cookie header");
      }

      const actorSnapshot: WorkflowActorSnapshot = {
        authMode: "browser_session",
        email: owner.email,
        membershipRoles: ["owner"],
        userId: owner.id,
      };

      for (let index = 0; index < 168; index += 1) {
        const commitPositionBase = BigInt(index) * 6n;

        // Comment: Projection batching keys off commitPosition, so this lag test
        // must seed monotonically increasing positions instead of the tiny fixed
        // values the smaller helper scenarios can get away with.
        await seedSucceededQueryAction({
          actionId: `query-lag-${runId}-${index}`,
          actorSnapshot,
          commitPositionBase,
          db,
          organizationId: organization.id as string,
          requestId: `req-query-lag-${runId}-${index}`,
          startedAt: new Date(Date.UTC(2026, 2, 27, 8, 0, index)),
        });
      }

      const firstResponse = await client.api.organizations[":slug"].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            limit: "1",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(firstResponse.status).toBe(200);

      const firstPage = auditListResponseSchema.parse(
        await firstResponse.json()
      );

      expect(firstPage.projectionLag).toEqual({
        queryAction: true,
        sourceApiAction: false,
      });

      const secondResponse = await client.api.organizations[":slug"].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            limit: "1",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(secondResponse.status).toBe(200);

      const secondPage = auditListResponseSchema.parse(
        await secondResponse.json()
      );

      expect(secondPage.projectionLag).toEqual({
        queryAction: false,
        sourceApiAction: false,
      });
    } finally {
      await closeDatabase(db as ClosableDatabase);
    }
  });

  it("scopes projection lag to the current organization", async () => {
    const harness = await createRouteIntegrationHarness({
      databaseUrl: await createPgliteDatabaseUrl(
        "onequery-org-audit-lag-scope-"
      ),
    });

    expect(harness.isOk()).toBe(true);
    if (harness.isErr()) {
      return;
    }

    const { client, db, test } = harness.value;
    const runId = createRunId();
    const owner = test.createUser({
      email: `audit-lag-scope-owner-${runId}@example.com`,
    });
    const visibleOrganization = test.createOrganization({
      name: `Audit Lag Visible ${runId}`,
      slug: `audit-lag-visible-${runId}`,
    });
    const laggingOrganization = test.createOrganization({
      name: `Audit Lag Hidden ${runId}`,
      slug: `audit-lag-hidden-${runId}`,
    });

    await test.saveUser(owner);

    try {
      await test.saveOrganization(visibleOrganization);
      await test.saveOrganization(laggingOrganization);
      await test.addMember({
        organizationId: visibleOrganization.id as string,
        role: "owner",
        userId: owner.id,
      });
      await test.addMember({
        organizationId: laggingOrganization.id as string,
        role: "owner",
        userId: owner.id,
      });

      const ownerLogin = await test.login({ userId: owner.id });
      const ownerCookie = ownerLogin.headers.get("cookie");

      if (!ownerCookie) {
        throw new Error("Owner login must expose a cookie header");
      }

      const actorSnapshot: WorkflowActorSnapshot = {
        authMode: "browser_session",
        email: owner.email,
        membershipRoles: ["owner"],
        userId: owner.id,
      };

      await seedSucceededQueryAction({
        actionId: `query-visible-${runId}`,
        actorSnapshot,
        commitPositionBase: 0n,
        db,
        organizationId: visibleOrganization.id as string,
        requestId: `req-query-visible-${runId}`,
        startedAt: new Date("2026-03-27T08:00:00.000Z"),
      });

      for (let index = 0; index < 168; index += 1) {
        const commitPositionBase = 6n + BigInt(index) * 6n;

        // Comment: This second org intentionally exceeds the per-request
        // projection batch cap so the visible org only stays warning-free when
        // lag detection is scoped to the requesting organization.
        await seedSucceededQueryAction({
          actionId: `query-hidden-${runId}-${index}`,
          actorSnapshot,
          commitPositionBase,
          db,
          organizationId: laggingOrganization.id as string,
          requestId: `req-query-hidden-${runId}-${index}`,
          startedAt: new Date(Date.UTC(2026, 2, 27, 9, 0, index)),
        });
      }

      const response = await client.api.organizations[":slug"].audit.$get(
        {
          param: {
            slug: visibleOrganization.slug as string,
          },
          query: {
            limit: "1",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(response.status).toBe(200);

      const page = auditListResponseSchema.parse(await response.json());

      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        family: "query_action",
        familyActionId: `query-visible-${runId}`,
      });
      expect(page.projectionLag).toEqual({
        queryAction: false,
        sourceApiAction: false,
      });
    } finally {
      await closeDatabase(db as ClosableDatabase);
    }
  });
});
