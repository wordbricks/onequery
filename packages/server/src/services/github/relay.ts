import type { JsonValue } from "@bufbuild/protobuf";
import { base64ToBytes } from "@onequery/codecs/base64";
import type { GitHubCredentials } from "@onequery/db/server";

import {
  DEFAULT_GITHUB_REPOSITORIES_QUERY_PARAMS,
  buildGitHubUrl,
  requestGitHubApi,
  toLegacyGitHubRelayBody,
} from "../../source-api/adapters/github";
import type { SourceApiRequestBody } from "../../source-api/types";

interface GitHubFetchOptions {
  body?: unknown;
  bodyBase64?: string;
  headers?: Record<string, string>;
  method?: "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT";
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

export type GitHubRelayResponse =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

export async function fetchGitHubApi(input: {
  credentials: GitHubCredentials;
  endpoint: string;
  options?: GitHubFetchOptions;
  repository?: string;
  userAgent?: string;
}): Promise<GitHubRelayResponse> {
  const url = buildGitHubUrl({
    credentials: input.credentials,
    endpoint: input.endpoint,
    params: input.options?.params,
    repository: input.repository,
  });
  const response = await requestGitHubApi({
    body: toSourceApiRequestBody(input.options),
    credentials: input.credentials,
    headers: input.options?.headers,
    method: (input.options?.method ?? "GET").toUpperCase(),
    timeoutMs: input.options?.timeoutMs,
    url,
    userAgent: input.userAgent,
  });

  return toLegacyGitHubRelayBody(response);
}

export async function listGitHubRepositories(input: {
  credentials: GitHubCredentials;
}): Promise<GitHubRelayResponse> {
  return fetchGitHubApi({
    credentials: input.credentials,
    endpoint: "/user/repos",
    options: {
      method: "GET",
      params: DEFAULT_GITHUB_REPOSITORIES_QUERY_PARAMS,
    },
  });
}

function toSourceApiRequestBody(
  options: GitHubFetchOptions | undefined
): SourceApiRequestBody {
  if (
    !options ||
    (options.body === undefined && options.bodyBase64 === undefined)
  ) {
    return { kind: "none" };
  }

  if (options.body !== undefined && options.bodyBase64 !== undefined) {
    throw new Error("Provide either body or bodyBase64, not both");
  }

  if (options.bodyBase64 !== undefined) {
    return {
      kind: "binary",
      value: base64ToBytes.decode(options.bodyBase64),
    };
  }

  return typeof options.body === "string"
    ? {
        kind: "text",
        value: options.body,
      }
    : {
        kind: "json",
        value: options.body as JsonValue,
      };
}
