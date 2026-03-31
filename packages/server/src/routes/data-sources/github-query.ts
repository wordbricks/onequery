import type { GitHubCredentials } from "@onequery/db/server";
import { z } from "zod";

import { fetchGitHubApi } from "../../services/github/relay";
import { MAX_PROVIDER_REQUEST_TIMEOUT_MS } from "../../services/provider-http";
import { createProviderRoute } from "./create-provider-route";
import { parseProviderRequest } from "./query-validation";

const methodSchema = z.enum(["fetch_api"]);

const githubFetchOptionsSchema = z
  .object({
    body: z.unknown().optional(),
    bodyBase64: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    method: z
      .enum(["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"])
      .optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
      .optional(),
  })
  .refine(
    (value) => !(value.body !== undefined && value.bodyBase64 !== undefined),
    {
      message: "Provide either body or bodyBase64, not both",
      path: ["bodyBase64"],
    }
  );

const fetchGitHubApiRequestSchema = z.object({
  endpoint: z.string().min(1),
  options: githubFetchOptionsSchema.optional(),
  repository: z.string().min(1).optional(),
});

function isGitHubCredentials(value: unknown): value is GitHubCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "github"
  );
}

export const dataSourcesGitHubQueryRoute = createProviderRoute<
  GitHubCredentials,
  typeof methodSchema,
  z.output<typeof fetchGitHubApiRequestSchema>
>({
  credentialsGuard: isGitHubCredentials,
  execute: ({ credentials, request }) =>
    fetchGitHubApi({
      credentials,
      endpoint: request.endpoint,
      options: request.options,
      repository: request.repository,
    }),
  methodSchema,
  parseRequest: (input) =>
    parseProviderRequest(
      fetchGitHubApiRequestSchema,
      input.request,
      "Invalid GitHub fetch_api request payload"
    ),
  provider: "github",
  providerLabel: "GitHub",
  routePath: "/github/query",
});
