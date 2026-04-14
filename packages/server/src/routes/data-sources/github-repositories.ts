import { zValidator } from "@hono/zod-validator";
import {
  and,
  CredentialsSchema,
  eq,
  getDatabaseSchema,
  isGitHubCredentials,
} from "@onequery/db/server";
import { Result } from "better-result";
import { Hono } from "hono";
import { z } from "zod";

import { requireOrgAccess } from "../../middleware/require-org-access";
import type { SessionVariables } from "../../middleware/session";
import { zodProblemHook } from "../../problem-details/zod-problem-hook";
import type { ServerRuntimeVariables } from "../../runtime-context";
import {
  decryptCredentialsObject,
  encryptCredentialsObject,
} from "../../services/crypto/credential-encryption";
import { listGitHubRepositories } from "../../services/github/relay";
import { createPrefixedQueryError, createQueryError } from "./query-errors";
import { OrgQuerySchema } from "./schemas";

const GitHubRepositoriesUpdateSchema = z.object({
  repositories: z.array(z.string().min(1)).default([]),
});

const GitHubRepositorySchema = z.object({
  full_name: z.string(),
  id: z.number(),
  name: z.string(),
  owner: z.object({
    login: z.string(),
  }),
  private: z.boolean(),
});

const GitHubRepositoriesSchema = z.array(GitHubRepositorySchema);

export const dataSourcesGitHubRepositoriesRoute = new Hono<{
  Variables: ServerRuntimeVariables & SessionVariables;
}>()
  .use("*", requireOrgAccess())
  .get(
    "/:id/github-repositories",
    zValidator("query", OrgQuerySchema, zodProblemHook()),
    async (c) => {
      const { organizationId } = c.req.valid("query");
      const id = c.req.param("id");
      const db = c.var.storage.db;
      const { dataSources } = getDatabaseSchema(db);

      const dataSource = await db.query.dataSources.findFirst({
        columns: {
          id: true,
          provider: true,
          status: true,
          credentialsEncrypted: true,
          credentialsIv: true,
        },
        where: and(
          eq(dataSources.id, id),
          eq(dataSources.organizationId, organizationId)
        ),
      });

      if (!dataSource) {
        return c.json({ error: "Data source not found" }, 404);
      }

      if (dataSource.provider !== "github") {
        return c.json({ error: "Data source is not GitHub" }, 400);
      }

      if (dataSource.status !== "active") {
        return c.json(
          { error: `Data source is not active (status: ${dataSource.status})` },
          400
        );
      }

      const credentials = decryptCredentialsObject(
        dataSource.credentialsEncrypted,
        dataSource.credentialsIv,
        c.var.runtime.crypto.masterEncryptionKey,
        CredentialsSchema
      );

      if (!isGitHubCredentials(credentials)) {
        return c.json({ error: "Invalid GitHub credentials" }, 400);
      }

      const result = await Result.tryPromise(() =>
        listGitHubRepositories({ credentials })
      );
      if (result.isErr()) {
        return c.json(
          createPrefixedQueryError("GitHub API error", result.error),
          502
        );
      }

      const parsed = GitHubRepositoriesSchema.safeParse(result.value);
      if (!parsed.success) {
        return c.json(
          createQueryError("Invalid GitHub repositories response"),
          502
        );
      }

      const repositories = parsed.data.map((repo) => ({
        fullName: repo.full_name,
        id: repo.id,
        name: repo.name,
        owner: repo.owner.login,
        private: repo.private,
      }));

      return c.json({
        repositories,
        selected: credentials.repositories ?? [],
      });
    }
  )
  .post(
    "/:id/github-repositories",
    zValidator("query", OrgQuerySchema, zodProblemHook()),
    zValidator("json", GitHubRepositoriesUpdateSchema, zodProblemHook()),
    async (c) => {
      const { organizationId } = c.req.valid("query");
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const db = c.var.storage.db;
      const { dataSources } = getDatabaseSchema(db);

      const dataSource = await db.query.dataSources.findFirst({
        where: and(
          eq(dataSources.id, id),
          eq(dataSources.organizationId, organizationId)
        ),
      });

      if (!dataSource) {
        return c.json({ error: "Data source not found" }, 404);
      }

      if (dataSource.provider !== "github") {
        return c.json({ error: "Data source is not GitHub" }, 400);
      }

      const credentials = decryptCredentialsObject(
        dataSource.credentialsEncrypted,
        dataSource.credentialsIv,
        c.var.runtime.crypto.masterEncryptionKey,
        CredentialsSchema
      );

      if (!isGitHubCredentials(credentials)) {
        return c.json({ error: "Invalid GitHub credentials" }, 400);
      }

      const trimmedRepositories = body.repositories
        .map((repo) => repo.trim())
        .filter((repo) => repo.length > 0);
      const repositories = [...new Set(trimmedRepositories)];

      const updatedCredentials = {
        ...credentials,
        repositories,
      };

      const encrypted = encryptCredentialsObject(
        updatedCredentials,
        c.var.runtime.crypto.masterEncryptionKey
      );

      await db
        .update(dataSources)
        .set({
          credentialsEncrypted: encrypted.ciphertext,
          credentialsIv: encrypted.iv,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dataSources.id, id),
            eq(dataSources.organizationId, organizationId)
          )
        );

      return c.json({ repositories, success: true });
    }
  );
