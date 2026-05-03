/**
 * Development seed script for local OSS development.
 *
 * Seeds a minimal OSS-safe control-plane dataset for the built-in local
 * development path. Uses a transaction for atomicity so partial seed state is
 * never committed.
 *
 * Run manually: `bun run db:seed:dev` from packages/db
 */

import { eq } from "drizzle-orm";

import { createDatabaseHandle } from "@/client";
import type { Database } from "@/client";
import { member, organization, session, user } from "@/schema/auth";
import { dataSources } from "@/schema/data-sources";
import { organizationProfiles } from "@/schema/organization-profiles";
import { ulid } from "@/schema/ulid";

import {
  DATA_SOURCE_IDS,
  DEV_ORG_ID,
  DEV_ORG_SLUG,
  DEV_USER_ID,
  PLACEHOLDER_ENCRYPTED,
  PLACEHOLDER_IV,
} from "./seed-dev-data";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function seedAuth(tx: Transaction) {
  await tx.insert(user).values({
    email: "dev@example.com",
    emailVerified: true,
    id: DEV_USER_ID,
    name: "Dev User",
  });

  await tx.insert(organization).values({
    id: DEV_ORG_ID,
    name: "Test Organization",
    slug: DEV_ORG_SLUG,
  });

  await tx.insert(member).values({
    id: ulid(),
    organizationId: DEV_ORG_ID,
    role: "owner",
    userId: DEV_USER_ID,
  });

  await tx.insert(session).values({
    activeOrganizationId: DEV_ORG_ID,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    id: "dev-session-id",
    token: "dev-session-token",
    userId: DEV_USER_ID,
  });

  await tx.insert(organizationProfiles).values({
    id: ulid(),
    kpis: [
      "Trial-to-Paid Conversion Rate",
      "Net Revenue Retention",
      "Customer Acquisition Cost",
      "Monthly Active Users",
    ],
    monthlyBudgetUsd: 300,
    northStarMetric: "Monthly Recurring Revenue (MRR)",
    organizationId: DEV_ORG_ID,
    websiteUrl: "https://example.com",
  });
}

async function seedDataSources(tx: Transaction) {
  await tx.insert(dataSources).values([
    {
      credentialsEncrypted: PLACEHOLDER_ENCRYPTED,
      credentialsIv: PLACEHOLDER_IV,
      id: DATA_SOURCE_IDS.postgres,
      name: "Production Database",
      organizationId: DEV_ORG_ID,
      provider: "postgres",
      status: "active",
    },
    {
      credentialsEncrypted: PLACEHOLDER_ENCRYPTED,
      credentialsIv: PLACEHOLDER_IV,
      id: DATA_SOURCE_IDS.ga,
      name: "Google Analytics",
      organizationId: DEV_ORG_ID,
      provider: "ga",
      status: "active",
    },
    {
      credentialsEncrypted: PLACEHOLDER_ENCRYPTED,
      credentialsIv: PLACEHOLDER_IV,
      errorMessage: "Authentication token expired",
      id: DATA_SOURCE_IDS.github,
      name: "GitHub Repository",
      organizationId: DEV_ORG_ID,
      provider: "github",
      status: "error",
      useAsDataSource: false,
    },
  ]);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to seed dev data.");
  }

  const database = createDatabaseHandle(connectionString);

  try {
    const existingOrg = await database.db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, DEV_ORG_ID))
      .limit(1);

    if (existingOrg.length > 0) {
      console.log("[OneQuery] Dev data exists, skipping seed");
      return;
    }

    await database.db.transaction(async (tx) => {
      await seedAuth(tx);
      await seedDataSources(tx);
    });

    console.log("[OneQuery] Dev data seeded (test-org)");
  } catch (error) {
    console.error("[OneQuery] Seeding failed:", error);
    throw error;
  } finally {
    await database.close();
  }
}

await main();
