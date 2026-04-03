import { createDb, eq, getDatabaseSchema } from "@onequery/db/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  closeDatabase,
  createPgliteDatabaseUrl,
  createRouteIntegrationHarness,
  createRunId,
} from "../test/integration-helpers";
import type { ClosableDatabase } from "../test/integration-helpers";

const AuditListItemSchema = z.object({
  action: z.object({
    provider: z.string().nullable(),
    requestId: z.string(),
    sourceId: z.string().nullable(),
    sourceKey: z.string(),
    type: z.enum(["validate", "execute"]),
  }),
  actor: z.object({
    email: z.string(),
    membershipRoles: z.array(z.string()),
    userId: z.string(),
  }),
  error: z
    .object({
      detail: z.string().nullable(),
      hint: z.string().nullable(),
    })
    .nullable(),
  family: z.literal("cli_query_action"),
  id: z.string(),
  metrics: z.object({
    elapsedMs: z.number().int().nullable(),
    retryable: z.boolean().nullable(),
    rowCount: z.number().int().nullable(),
  }),
  occurredAt: z.coerce.date(),
  query: z.object({
    normalizedSql: z.string().nullable(),
    normalizedSqlChanged: z.boolean(),
    sql: z.string(),
  }),
  state: z.object({
    lastEventType: z.enum([
      "query_rejected",
      "query_timed_out",
      "usage_persisted",
    ]),
    stage: z.enum(["completed"]),
    status: z.enum(["query_rejected", "query_timed_out", "succeeded"]),
    usagePersistenceStatus: z.enum(["not_started", "succeeded"]),
  }),
});

const AuditResponseSchema = z.object({
  families: z.array(z.literal("cli_query_action")),
  items: z.array(AuditListItemSchema),
  nextCursor: z.string().nullable(),
});

async function seedAuditAction(input: {
  actorEmail: string;
  actorMembershipRoles: string[];
  actorUserId: string;
  actionId: string;
  actionType: "validate" | "execute";
  db: ReturnType<typeof createDb>;
  errorDetail?: string;
  errorHint?: string;
  eventId: string;
  eventType: "query_rejected" | "query_timed_out" | "usage_persisted";
  occurredAt: Date;
  organizationId: string;
  requestId: string;
  retryable?: boolean;
  rowCount?: number;
  sourceKey: string;
  sql: string;
  status: "query_rejected" | "query_timed_out" | "succeeded";
  usagePersistenceStatus: "not_started" | "succeeded";
}) {
  const db = input.db;
  const { cliQueryActionEvents, cliQueryActions } = getDatabaseSchema(db);
  const receivedEventId = `${input.eventId}-received`;

  await db.insert(cliQueryActions).values({
    actionType: input.actionType,
    actorAuthMode: "browser_session",
    actorEmail: input.actorEmail,
    actorMembershipRoles: input.actorMembershipRoles,
    actorUserId: input.actorUserId,
    completedAt: input.occurredAt,
    createdAt: input.occurredAt,
    errorDetail: input.errorDetail,
    errorHint: input.errorHint,
    id: input.actionId,
    lastEventAt: input.occurredAt,
    organizationId: input.organizationId,
    requestId: input.requestId,
    retryable: input.retryable,
    rowCount: input.rowCount,
    sourceKey: input.sourceKey,
    sql: input.sql,
    stage: "completed",
    status: input.status,
    updatedAt: input.occurredAt,
    usagePersistenceStatus: input.usagePersistenceStatus,
    version: 1,
  });

  await db.insert(cliQueryActionEvents).values({
    actionType: input.actionType,
    actorAuthMode: "browser_session",
    actorEmail: input.actorEmail,
    actorMembershipRoles: input.actorMembershipRoles,
    actorUserId: input.actorUserId,
    eventType: "action_received",
    id: receivedEventId,
    occurredAt: new Date(input.occurredAt.getTime() - 1000),
    organizationId: input.organizationId,
    queryActionId: input.actionId,
    requestId: input.requestId,
    sourceKey: input.sourceKey,
    sql: input.sql,
    stage: "received",
    status: "pending",
    usagePersistenceStatus: "not_started",
  });

  await db.insert(cliQueryActionEvents).values({
    actionType: input.actionType,
    actorAuthMode: "browser_session",
    actorEmail: input.actorEmail,
    actorMembershipRoles: input.actorMembershipRoles,
    actorUserId: input.actorUserId,
    causationEventId: receivedEventId,
    errorDetail: input.errorDetail,
    errorHint: input.errorHint,
    eventType: input.eventType,
    id: input.eventId,
    occurredAt: input.occurredAt,
    organizationId: input.organizationId,
    queryActionId: input.actionId,
    requestId: input.requestId,
    retryable: input.retryable,
    rowCount: input.rowCount,
    sourceKey: input.sourceKey,
    stage: "completed",
    status: input.status,
    usagePersistenceStatus: input.usagePersistenceStatus,
  });

  await db
    .update(cliQueryActions)
    .set({ lastEventId: input.eventId })
    .where(eq(cliQueryActions.id, input.actionId));
}

describe("organizations audit route", () => {
  it("lists org audit entries newest-first, paginates them, and applies filters", async () => {
    const { client, db, test } = await createRouteIntegrationHarness({
      databaseUrl: await createPgliteDatabaseUrl("onequery-org-audit-"),
    });

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

      await seedAuditAction({
        actorEmail: owner.email,
        actorMembershipRoles: ["owner"],
        actorUserId: owner.id,
        actionId: `action-execute-${runId}`,
        actionType: "execute",
        db,
        eventId: `event-execute-${runId}`,
        eventType: "usage_persisted",
        occurredAt: new Date("2026-03-27T10:00:00.000Z"),
        organizationId: organization.id as string,
        requestId: `req-execute-${runId}`,
        rowCount: 12,
        sourceKey: "warehouse",
        sql: "select * from customers",
        status: "succeeded",
        usagePersistenceStatus: "succeeded",
      });

      await seedAuditAction({
        actorEmail: owner.email,
        actorMembershipRoles: ["owner"],
        actorUserId: owner.id,
        actionId: `action-rejected-${runId}`,
        actionType: "validate",
        db,
        errorDetail: "unsafe mutation",
        errorHint: "remove write statements",
        eventId: `event-rejected-${runId}`,
        eventType: "query_rejected",
        occurredAt: new Date("2026-03-27T09:00:00.000Z"),
        organizationId: organization.id as string,
        requestId: `req-rejected-${runId}`,
        sourceKey: "billing",
        sql: "delete from rejected_accounts",
        status: "query_rejected",
        usagePersistenceStatus: "not_started",
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

      const firstPage = AuditResponseSchema.parse(
        await firstPageResponse.json()
      );

      expect(firstPage.families).toEqual(["cli_query_action"]);
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.items[0]?.id).toBe(`action-execute-${runId}`);
      expect(firstPage.items[0]?.state.lastEventType).toBe("usage_persisted");
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

      const secondPage = AuditResponseSchema.parse(
        await secondPageResponse.json()
      );

      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.items[0]?.id).toBe(`action-rejected-${runId}`);
      expect(secondPage.nextCursor).toBeNull();

      const filteredResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            actionType: "validate",
            q: "REJECTED",
            sourceKey: "billing",
            status: "query_rejected",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(filteredResponse.status).toBe(200);

      const filtered = AuditResponseSchema.parse(await filteredResponse.json());

      expect(filtered.items).toHaveLength(1);
      expect(filtered.items[0]).toMatchObject({
        id: `action-rejected-${runId}`,
        query: {
          sql: "delete from rejected_accounts",
        },
        state: {
          lastEventType: "query_rejected",
          status: "query_rejected",
        },
      });
    } finally {
      await closeDatabase(db as ClosableDatabase);
    }
  });

  it("rejects unauthenticated and unauthorized audit reads and returns 404 for unknown orgs", async () => {
    const { client, db, test } = await createRouteIntegrationHarness({
      databaseUrl: await createPgliteDatabaseUrl("onequery-org-audit-access-"),
    });

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
});
