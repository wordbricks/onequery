import { dataSources, member, organization, user } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { test as it } from "@onequery/db/testing/setup";
import { describe, expect } from "vitest";

import { runCliLoadOrgAccess, runCliLoadOrgAccessWithSource } from "./effects";

async function insertUser(db: Database, id: string) {
  await db.insert(user).values({
    email: `${id}@example.com`,
    emailVerified: true,
    id,
    name: "Test User",
  });
}

async function insertOrganization(
  db: Database,
  input: {
    id: string;
    name: string;
    slug: string | null;
  }
) {
  await db.insert(organization).values(input);
}

async function insertMember(
  db: Database,
  input: {
    id: string;
    organizationId: string;
    role: string;
    userId: string;
  }
) {
  await db.insert(member).values(input);
}

async function insertDataSource(
  db: Database,
  input: {
    id: string;
    name: string;
    organizationId: string;
    provider?: "github" | "postgres";
  }
) {
  await db.insert(dataSources).values({
    credentialsEncrypted: `encrypted-${input.id}`,
    credentialsIv: `iv-${input.id}`,
    id: input.id,
    name: input.name,
    organizationId: input.organizationId,
    provider: input.provider ?? "github",
    status: "active",
  });
}

describe("runCliLoadOrgAccess", { timeout: 60_000 }, () => {
  it("returns not_found when the organization is missing", async ({ db }) => {
    await expect(
      runCliLoadOrgAccess({
        db,
        orgSlug: "missing",
        userId: "user-missing",
      })
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("returns not_found when the matched organization slug is blank", async ({
    db,
  }) => {
    await insertUser(db, "user-blank");
    await insertOrganization(db, {
      id: "org-blank",
      name: "Blank Slug Org",
      slug: " ",
    });
    await insertMember(db, {
      id: "member-blank",
      organizationId: "org-blank",
      role: "admin",
      userId: "user-blank",
    });

    await expect(
      runCliLoadOrgAccess({
        db,
        orgSlug: " ",
        userId: "user-blank",
      })
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("returns not_found when the organization slug lookup is null at runtime", async ({
    db,
  }) => {
    await insertUser(db, "user-null");
    await insertOrganization(db, {
      id: "org-null",
      name: "Null Slug Org",
      slug: null,
    });
    await insertMember(db, {
      id: "member-null",
      organizationId: "org-null",
      role: "admin",
      userId: "user-null",
    });

    await expect(
      runCliLoadOrgAccess({
        db,
        orgSlug: null as unknown as string,
        userId: "user-null",
      })
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("returns forbidden when the organization exists without membership", async ({
    db,
  }) => {
    await insertOrganization(db, {
      id: "org-forbidden",
      name: "Forbidden Org",
      slug: "forbidden",
    });

    await expect(
      runCliLoadOrgAccess({
        db,
        orgSlug: "forbidden",
        userId: "user-without-membership",
      })
    ).resolves.toEqual({ kind: "forbidden" });
  });

  it("returns accessible organization details and membership role", async ({
    db,
  }) => {
    await insertUser(db, "user-found");
    await insertOrganization(db, {
      id: "org-found",
      name: " Acme Inc ",
      slug: " acme ",
    });
    await insertMember(db, {
      id: "member-found",
      organizationId: "org-found",
      role: "admin",
      userId: "user-found",
    });

    await expect(
      runCliLoadOrgAccess({
        db,
        orgSlug: " acme ",
        userId: "user-found",
      })
    ).resolves.toEqual({
      kind: "found",
      org: {
        id: "org-found",
        name: "Acme Inc",
        slug: "acme",
      },
      rawMembershipRole: "admin",
    });
  });
});

describe("runCliLoadOrgAccessWithSource", { timeout: 60_000 }, () => {
  it("returns org access and the requested source in one lookup", async ({
    db,
  }) => {
    await insertUser(db, "user-source-found");
    await insertOrganization(db, {
      id: "org-source-found",
      name: "Source Org",
      slug: "source-org",
    });
    await insertMember(db, {
      id: "member-source-found",
      organizationId: "org-source-found",
      role: "owner",
      userId: "user-source-found",
    });
    await insertDataSource(db, {
      id: "source-found",
      name: "github-prod",
      organizationId: "org-source-found",
    });

    await expect(
      runCliLoadOrgAccessWithSource({
        db,
        orgSlug: "source-org",
        sourceKey: "github-prod",
        sourceProvider: "github",
        userId: "user-source-found",
      })
    ).resolves.toEqual({
      access: {
        kind: "found",
        org: {
          id: "org-source-found",
          name: "Source Org",
          slug: "source-org",
        },
        rawMembershipRole: "owner",
      },
      source: {
        kind: "found",
        source: {
          credentialsEncrypted: "encrypted-source-found",
          credentialsIv: "iv-source-found",
          displayName: null,
          id: "source-found",
          name: "github-prod",
          organizationId: "org-source-found",
          provider: "github",
          sourceKey: "github-prod",
          status: "active",
        },
      },
    });
  });

  it("keeps source lookup scoped to an authorized org result", async ({
    db,
  }) => {
    await insertOrganization(db, {
      id: "org-source-forbidden",
      name: "Forbidden Source Org",
      slug: "source-forbidden",
    });
    await insertDataSource(db, {
      id: "source-forbidden",
      name: "github-prod",
      organizationId: "org-source-forbidden",
    });

    await expect(
      runCliLoadOrgAccessWithSource({
        db,
        orgSlug: "source-forbidden",
        sourceKey: "github-prod",
        sourceProvider: "github",
        userId: "user-without-source-access",
      })
    ).resolves.toEqual({
      access: {
        kind: "forbidden",
      },
      source: null,
    });
  });

  it("returns source not_found without losing successful org access", async ({
    db,
  }) => {
    await insertUser(db, "user-source-missing");
    await insertOrganization(db, {
      id: "org-source-missing",
      name: "Missing Source Org",
      slug: "source-missing",
    });
    await insertMember(db, {
      id: "member-source-missing",
      organizationId: "org-source-missing",
      role: "owner",
      userId: "user-source-missing",
    });

    await expect(
      runCliLoadOrgAccessWithSource({
        db,
        orgSlug: "source-missing",
        sourceKey: "github-prod",
        sourceProvider: "github",
        userId: "user-source-missing",
      })
    ).resolves.toMatchObject({
      access: {
        kind: "found",
        org: {
          id: "org-source-missing",
          slug: "source-missing",
        },
      },
      source: {
        kind: "not_found",
      },
    });
  });

  it("requires the requested source provider to match", async ({ db }) => {
    await insertUser(db, "user-source-provider");
    await insertOrganization(db, {
      id: "org-source-provider",
      name: "Provider Source Org",
      slug: "source-provider",
    });
    await insertMember(db, {
      id: "member-source-provider",
      organizationId: "org-source-provider",
      role: "owner",
      userId: "user-source-provider",
    });
    await insertDataSource(db, {
      id: "source-provider",
      name: "warehouse",
      organizationId: "org-source-provider",
      provider: "postgres",
    });

    await expect(
      runCliLoadOrgAccessWithSource({
        db,
        orgSlug: "source-provider",
        sourceKey: "warehouse",
        sourceProvider: "github",
        userId: "user-source-provider",
      })
    ).resolves.toMatchObject({
      access: {
        kind: "found",
        org: {
          id: "org-source-provider",
          slug: "source-provider",
        },
      },
      source: {
        kind: "not_found",
      },
    });
  });
});
