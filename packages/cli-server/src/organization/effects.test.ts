import { member, organization, user } from "@onequery/db/server";
import { pgliteTestDb } from "@onequery/db/testing/setup";
import { describe, expect, it } from "vitest";

import { runCliLoadOrgAccess } from "./effects";

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
