import { dataSources, member, organization, user } from "@onequery/db/server";
import { pgliteTestDb } from "@onequery/db/testing/setup";
import { describe, expect, it } from "vitest";

import { runCliLoadOrgAccess, runCliLoadOrgAccessWithSource } from "./effects";

async function insertUser(id: string) {
  await pgliteTestDb.insert(user).values({
    email: `${id}@example.com`,
    emailVerified: true,
    id,
    name: "Test User",
  });
}

async function insertOrganization(input: {
  id: string;
  name: string;
  slug: string | null;
}) {
  await pgliteTestDb.insert(organization).values(input);
}

async function insertMember(input: {
  id: string;
  organizationId: string;
  role: string;
  userId: string;
}) {
  await pgliteTestDb.insert(member).values(input);
}

async function insertDataSource(input: {
  id: string;
  name: string;
  organizationId: string;
}) {
  await pgliteTestDb.insert(dataSources).values({
    credentialsEncrypted: `encrypted-${input.id}`,
    credentialsIv: `iv-${input.id}`,
    id: input.id,
    name: input.name,
    organizationId: input.organizationId,
    provider: "github",
    status: "active",
  });
}

describe("runCliLoadOrgAccess", () => {
  it("returns not_found when the organization is missing", async () => {
    await expect(
      runCliLoadOrgAccess({
        db: pgliteTestDb,
        orgSlug: "missing",
        userId: "user-missing",
      })
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("returns not_found when the matched organization slug is blank", async () => {
    await insertUser("user-blank");
    await insertOrganization({
      id: "org-blank",
      name: "Blank Slug Org",
      slug: " ",
    });
    await insertMember({
      id: "member-blank",
      organizationId: "org-blank",
      role: "admin",
      userId: "user-blank",
    });

    await expect(
      runCliLoadOrgAccess({
        db: pgliteTestDb,
        orgSlug: " ",
        userId: "user-blank",
      })
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("returns not_found when the organization slug lookup is null at runtime", async () => {
    await insertUser("user-null");
    await insertOrganization({
      id: "org-null",
      name: "Null Slug Org",
      slug: null,
    });
    await insertMember({
      id: "member-null",
      organizationId: "org-null",
      role: "admin",
      userId: "user-null",
    });

    await expect(
      runCliLoadOrgAccess({
        db: pgliteTestDb,
        orgSlug: null as unknown as string,
        userId: "user-null",
      })
    ).resolves.toEqual({ kind: "not_found" });
  });

  it("returns forbidden when the organization exists without membership", async () => {
    await insertOrganization({
      id: "org-forbidden",
      name: "Forbidden Org",
      slug: "forbidden",
    });

    await expect(
      runCliLoadOrgAccess({
        db: pgliteTestDb,
        orgSlug: "forbidden",
        userId: "user-without-membership",
      })
    ).resolves.toEqual({ kind: "forbidden" });
  });

  it("returns accessible organization details and membership role", async () => {
    await insertUser("user-found");
    await insertOrganization({
      id: "org-found",
      name: " Acme Inc ",
      slug: " acme ",
    });
    await insertMember({
      id: "member-found",
      organizationId: "org-found",
      role: "admin",
      userId: "user-found",
    });

    await expect(
      runCliLoadOrgAccess({
        db: pgliteTestDb,
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

describe("runCliLoadOrgAccessWithSource", () => {
  it("returns org access and the requested source in one lookup", async () => {
    await insertUser("user-source-found");
    await insertOrganization({
      id: "org-source-found",
      name: "Source Org",
      slug: "source-org",
    });
    await insertMember({
      id: "member-source-found",
      organizationId: "org-source-found",
      role: "owner",
      userId: "user-source-found",
    });
    await insertDataSource({
      id: "source-found",
      name: "github-prod",
      organizationId: "org-source-found",
    });

    await expect(
      runCliLoadOrgAccessWithSource({
        db: pgliteTestDb,
        orgSlug: "source-org",
        sourceKey: "github-prod",
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

  it("keeps source lookup scoped to an authorized org result", async () => {
    await insertOrganization({
      id: "org-source-forbidden",
      name: "Forbidden Source Org",
      slug: "source-forbidden",
    });
    await insertDataSource({
      id: "source-forbidden",
      name: "github-prod",
      organizationId: "org-source-forbidden",
    });

    await expect(
      runCliLoadOrgAccessWithSource({
        db: pgliteTestDb,
        orgSlug: "source-forbidden",
        sourceKey: "github-prod",
        userId: "user-without-source-access",
      })
    ).resolves.toEqual({
      access: {
        kind: "forbidden",
      },
      source: null,
    });
  });

  it("returns source not_found without losing successful org access", async () => {
    await insertUser("user-source-missing");
    await insertOrganization({
      id: "org-source-missing",
      name: "Missing Source Org",
      slug: "source-missing",
    });
    await insertMember({
      id: "member-source-missing",
      organizationId: "org-source-missing",
      role: "owner",
      userId: "user-source-missing",
    });

    await expect(
      runCliLoadOrgAccessWithSource({
        db: pgliteTestDb,
        orgSlug: "source-missing",
        sourceKey: "github-prod",
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
});
