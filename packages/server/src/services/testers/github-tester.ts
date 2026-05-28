import type { GitHubCredentials } from "@onequery/db/server";
import {
  createFailedConnectionTest,
  createSuccessfulConnectionTest,
} from "@onequery/query/connection-test";
import type { ConnectionTestOutcome } from "@onequery/query/connection-test";
import { Result } from "better-result";

import { fetchGitHubApi } from "../github/relay";

function normalizeRepositoryFullName(value: string): string | null {
  const parts = value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((part) => part.length > 0);
  if (parts.length !== 2) {
    return null;
  }
  return `${parts[0]}/${parts[1]}`;
}

export async function testGitHubConnection(
  credentials: GitHubCredentials
): Promise<ConnectionTestOutcome> {
  const startTime = Date.now();

  try {
    for (const repository of credentials.repositories ?? []) {
      const normalizedRepository = normalizeRepositoryFullName(repository);
      if (!normalizedRepository) {
        return Result.err(
          createFailedConnectionTest({
            detail: `GitHub repository must be in owner/repo format: ${repository}`,
            latencyMs: Date.now() - startTime,
            message: "Invalid GitHub repository selection",
          })
        );
      }
    }

    await fetchGitHubApi({
      credentials,
      endpoint: "/user",
    });

    for (const repository of credentials.repositories ?? []) {
      const normalizedRepository = normalizeRepositoryFullName(repository);
      if (!normalizedRepository) {
        continue;
      }
      await fetchGitHubApi({
        credentials,
        endpoint: `/repos/${normalizedRepository}`,
      });
    }

    return Result.ok(createSuccessfulConnectionTest(Date.now() - startTime));
  } catch (error) {
    return Result.err(
      createFailedConnectionTest({
        detail:
          error instanceof Error
            ? error.message
            : "Failed to validate GitHub credentials",
        latencyMs: Date.now() - startTime,
        message: "GitHub connection validation failed",
      })
    );
  }
}
