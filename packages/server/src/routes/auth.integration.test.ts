import {
  and,
  connectorJobs,
  connectors,
  dataSources,
  eq,
  member,
  organizationProfiles,
  session as authSessionTable,
} from "@onequery/db/server";
import { describe, expect, it } from "vitest";

import {
  createRouteIntegrationHarness,
  createRunId,
} from "../test/integration-helpers";

describe("auth route organization deletion guardrails", () => {
  it("blocks self-serve org deletion and preserves org-owned state", async () => {
    const harness = await createRouteIntegrationHarness();

    expect(harness.isOk()).toBe(true);
    if (harness.isErr()) {
      return;
    }

    const { app, auth, db, test } = harness.value;

    const runId = createRunId();
    const user = test.createUser({
      email: `org-delete-guardrails-${runId}@example.com`,
    });
    const org = test.createOrganization({
      name: `Org Delete Guardrails ${runId}`,
      slug: `org-delete-guardrails-${runId}`,
    });
    const connectorId = `connector-${runId}`;
    const connectorJobId = `connector-job-${runId}`;
    const dataSourceId = `data-source-${runId}`;

    await test.saveUser(user);

    try {
      await test.saveOrganization(org);
      await test.addMember({
        organizationId: org.id as string,
        role: "owner",
        userId: user.id,
      });

      const login = await test.login({ userId: user.id });
      await db
        .update(authSessionTable)
        .set({ activeOrganizationId: org.id as string })
        .where(eq(authSessionTable.token, login.session.token));

      await db.insert(organizationProfiles).values({
        id: `org-profile-${runId}`,
        organizationId: org.id as string,
      });
      await db.insert(connectors).values({
        authTokenHash: `auth-token-hash-${runId}`,
        connectorId,
        connectorName: "Athena Connector",
        organizationId: org.id as string,
      });
      await db.insert(connectorJobs).values({
        connectorId,
        database: "analytics",
        jobId: connectorJobId,
        sql: "select 1",
        status: "queued",
      });
      await db.insert(dataSources).values({
        credentialsEncrypted: "encrypted-creds",
        credentialsIv: "iv",
        id: dataSourceId,
        name: `Warehouse ${runId}`,
        organizationId: org.id as string,
        provider: "postgres",
      });

      const seededSession = await auth.api.getSession({
        headers: login.headers,
      });

      expect(seededSession?.session.activeOrganizationId).toBe(org.id);

      const response = await app.request(
        "http://localhost/api/auth/organization/delete",
        {
          body: JSON.stringify({ organizationId: org.id }),
          headers: {
            "content-type": "application/json",
            cookie: login.headers.get("cookie") ?? "",
          },
          method: "POST",
        }
      );

      const responseText = await response.text();

      expect(response.status).toBe(404);
      expect(responseText).toContain("ORGANIZATION_DELETION_DISABLED");
      expect(responseText).toContain("Organization deletion is disabled");

      const persistedSession = await auth.api.getSession({
        headers: login.headers,
      });
      const persistedMembership = await db.query.member.findFirst({
        where: and(
          eq(member.organizationId, org.id as string),
          eq(member.userId, user.id)
        ),
      });
      const persistedProfile = await db.query.organizationProfiles.findFirst({
        where: eq(organizationProfiles.organizationId, org.id as string),
      });
      const persistedConnector = await db.query.connectors.findFirst({
        where: eq(connectors.connectorId, connectorId),
      });
      const persistedConnectorJob = await db.query.connectorJobs.findFirst({
        where: eq(connectorJobs.jobId, connectorJobId),
      });
      const persistedDataSource = await db.query.dataSources.findFirst({
        where: eq(dataSources.id, dataSourceId),
      });

      expect(persistedSession?.session.activeOrganizationId).toBe(org.id);
      expect(persistedMembership?.role).toBe("owner");
      expect(persistedProfile?.organizationId).toBe(org.id);
      expect(persistedConnector?.organizationId).toBe(org.id);
      expect(persistedConnectorJob?.connectorId).toBe(connectorId);
      expect(persistedDataSource?.organizationId).toBe(org.id);
    } finally {
      await test.deleteOrganization?.(org.id as string);
      await test.deleteUser(user.id);
    }
  });
});
