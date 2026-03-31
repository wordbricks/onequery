import { base64ToBytes } from "@onequery/codecs/base64";
import type { GitHubCredentials } from "@onequery/db/server";

import { MAX_PROVIDER_ERROR_DETAIL_LENGTH } from "../provider-http";
import { ProviderHttpClient } from "../provider-http-client";
import { hasControlCharacters, serializeQueryParam } from "../provider-utils";

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_UPLOADS_API_BASE_URL = "https://uploads.github.com";
const BLOCKED_QUERY_PARAM_NAMES = new Set([
  "access_token",
  "authorization",
  "client_secret",
]);
const ALLOWED_GITHUB_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "PATCH",
  "POST",
  "PUT",
]);

interface GitHubFetchOptions {
  body?: unknown;
  bodyBase64?: string;
  headers?: Record<string, string>;
  method?: "DELETE" | "GET" | "HEAD" | "PATCH" | "POST" | "PUT";
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

interface GitHubBinaryRelayResponse {
  bodyBase64: string;
  contentType: string | null;
  size: number;
  type: "binary";
}

type GitHubRelayResponse =
  | GitHubBinaryRelayResponse
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

const REPO_SCOPED_ENDPOINT_ROOTS = new Set([
  "actions",
  "assignees",
  "branches",
  "check-runs",
  "check-suites",
  "code-scanning",
  "collaborators",
  "comments",
  "commits",
  "compare",
  "contents",
  "contributors",
  "dependabot",
  "dependency-graph",
  "deployments",
  "dispatches",
  "environments",
  "events",
  "forks",
  "git",
  "hooks",
  "issues",
  "keys",
  "labels",
  "languages",
  "milestones",
  "notifications",
  "pages",
  "pulls",
  "readme",
  "releases",
  "rules",
  "secret-scanning",
  "stargazers",
  "stats",
  "statuses",
  "subscribers",
  "subscription",
  "tags",
  "tarball",
  "teams",
  "topics",
  "traffic",
  "zipball",
]);

const DEFAULT_GITHUB_REPOSITORIES_QUERY_PARAMS = {
  affiliation: "owner,collaborator,organization_member",
  direction: "desc",
  per_page: 100,
  sort: "updated",
} as const;

function parseGitHubErrorDetail(errorText: string): string {
  const trimmed = errorText.trim();
  if (trimmed.length === 0) {
    return "Unknown error";
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "message" in parsed &&
      typeof parsed.message === "string" &&
      parsed.message.trim().length > 0
    ) {
      return parsed.message.trim().slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
    }
  } catch {
    // Fall back to raw text.
  }
  return trimmed.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}

function sanitizeGitHubText(
  text: string,
  credentials: GitHubCredentials
): string {
  if (credentials.accessToken.length === 0) {
    return text;
  }
  return text.split(credentials.accessToken).join("***");
}

function normalizeGitHubMethod(method: string | undefined): string {
  const normalized = (method ?? "GET").toUpperCase();
  if (!ALLOWED_GITHUB_METHODS.has(normalized)) {
    throw new Error(`Unsupported GitHub method: ${normalized}`);
  }
  return normalized;
}

function normalizeRepositoryFullName(repository: string): string {
  const trimmed = repository.trim().replace(/^\/+|\/+$/g, "");
  const parts = trimmed.split("/").filter((part) => part.length > 0);
  if (parts.length !== 2) {
    throw new Error("repository must be in the format <owner>/<repo>");
  }
  return `${parts[0]}/${parts[1]}`;
}

function normalizedSelectedRepositories(
  credentials: GitHubCredentials
): string[] {
  return [
    ...new Set(
      (credentials.repositories ?? []).map(normalizeRepositoryFullName)
    ),
  ];
}

function extractRepositoryFromUrl(url: URL): string | null {
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  if (parts.length < 3 || parts[0] !== "repos") {
    return null;
  }
  return `${parts[1]}/${parts[2]}`;
}

function isRepoScopedRelativeEndpoint(endpoint: string): boolean {
  const trimmed = endpoint.trim();
  if (trimmed.length === 0 || trimmed.startsWith("https://")) {
    return false;
  }

  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (path.startsWith("/repos/")) {
    return false;
  }

  const [root] = path.slice(1).split("/", 1);
  return REPO_SCOPED_ENDPOINT_ROOTS.has(root ?? "");
}

function assertRepositoryAllowed(input: {
  allowedRepositories: string[];
  repository: string;
}) {
  if (input.allowedRepositories.length === 0) {
    return;
  }

  if (
    !input.allowedRepositories.some(
      (allowed) => allowed.toLowerCase() === input.repository.toLowerCase()
    )
  ) {
    throw new Error(
      `repository "${input.repository}" is not connected to this GitHub data source`
    );
  }
}

function normalizeGitHubApiUrl(endpoint: string): URL {
  const normalizedEndpoint = endpoint.trim();
  if (normalizedEndpoint.length === 0) {
    throw new Error("endpoint is required");
  }

  const url = normalizedEndpoint.startsWith("https://")
    ? new URL(normalizedEndpoint)
    : new URL(
        normalizedEndpoint.startsWith("/")
          ? normalizedEndpoint
          : `/${normalizedEndpoint}`,
        `${GITHUB_API_BASE_URL}/`
      );

  if (url.protocol !== "https:") {
    throw new Error("GitHub endpoint must use https");
  }

  if (
    url.origin !== GITHUB_API_BASE_URL &&
    url.origin !== GITHUB_UPLOADS_API_BASE_URL
  ) {
    throw new Error(
      "GitHub endpoint must target api.github.com or uploads.github.com"
    );
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("GitHub endpoint must not include URL credentials");
  }

  if (url.hash.length > 0) {
    throw new Error("GitHub endpoint must not include a fragment");
  }

  return url;
}

function assertGitHubQueryParamsAllowed(url: URL): void {
  for (const key of url.searchParams.keys()) {
    if (BLOCKED_QUERY_PARAM_NAMES.has(key.toLowerCase())) {
      throw new Error(
        `GitHub endpoint query parameter "${key}" is not allowed`
      );
    }
  }
}

function buildGitHubUrl(input: {
  credentials: GitHubCredentials;
  endpoint: string;
  params?: Record<string, unknown>;
  repository?: string;
}): string {
  const selectedRepositories = normalizedSelectedRepositories(
    input.credentials
  );
  const requestedRepository =
    input.repository === undefined
      ? undefined
      : normalizeRepositoryFullName(input.repository);

  if (requestedRepository) {
    assertRepositoryAllowed({
      allowedRepositories: selectedRepositories,
      repository: requestedRepository,
    });
  }

  let normalizedEndpoint = input.endpoint;
  if (isRepoScopedRelativeEndpoint(input.endpoint)) {
    const resolvedRepository =
      requestedRepository ??
      (selectedRepositories.length === 1 ? selectedRepositories[0] : undefined);

    if (!resolvedRepository) {
      throw new Error(
        selectedRepositories.length > 1
          ? "multiple repositories are connected; pass request.repository as <owner>/<repo>"
          : "repo-scoped endpoints require request.repository or an explicit /repos/<owner>/<repo> path"
      );
    }

    const relativePath = input.endpoint.startsWith("/")
      ? input.endpoint
      : `/${input.endpoint}`;
    normalizedEndpoint = `/repos/${resolvedRepository}${relativePath}`;
  }

  const url = normalizeGitHubApiUrl(normalizedEndpoint);
  const urlRepository = extractRepositoryFromUrl(url);
  if (urlRepository) {
    assertRepositoryAllowed({
      allowedRepositories: selectedRepositories,
      repository: urlRepository,
    });
    if (
      requestedRepository &&
      urlRepository.toLowerCase() !== requestedRepository.toLowerCase()
    ) {
      throw new Error(
        `request.repository (${requestedRepository}) does not match endpoint repository (${urlRepository})`
      );
    }
  }

  for (const [key, value] of Object.entries(input.params ?? {})) {
    if (BLOCKED_QUERY_PARAM_NAMES.has(key.toLowerCase())) {
      throw new Error(`GitHub request param "${key}" is not allowed`);
    }

    const serialized = serializeQueryParam(value);
    if (serialized === null) {
      continue;
    }
    url.searchParams.set(key, serialized);
  }

  assertGitHubQueryParamsAllowed(url);

  return url.toString();
}

function normalizeGitHubHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers ?? {})) {
    const normalizedKey = key.trim();
    if (normalizedKey.length === 0) {
      continue;
    }

    if (hasControlCharacters(normalizedKey) || hasControlCharacters(value)) {
      throw new Error(`Invalid GitHub header: ${normalizedKey}`);
    }

    const lowerKey = normalizedKey.toLowerCase();
    if (
      lowerKey === "authorization" ||
      lowerKey === "cookie" ||
      lowerKey === "content-length" ||
      lowerKey === "host" ||
      lowerKey === "proxy-authorization" ||
      lowerKey === "user-agent"
    ) {
      continue;
    }

    normalized[normalizedKey] = value;
  }

  return normalized;
}

function buildGitHubRequestBody(input: {
  headers: Record<string, string>;
  method: string;
  options?: GitHubFetchOptions;
}): BodyInit | undefined {
  if (!input.options) {
    return undefined;
  }

  const hasJsonBody = input.options.body !== undefined;
  const hasBinaryBody = input.options.bodyBase64 !== undefined;
  if (hasJsonBody && hasBinaryBody) {
    throw new Error("Provide either body or bodyBase64, not both");
  }

  if (
    (hasJsonBody || hasBinaryBody) &&
    (input.method === "GET" || input.method === "HEAD")
  ) {
    throw new Error("GET and HEAD requests cannot include a request body");
  }

  if (hasBinaryBody) {
    const hasContentTypeHeader = Object.keys(input.headers).some(
      (key) => key.toLowerCase() === "content-type"
    );
    if (!hasContentTypeHeader) {
      input.headers["Content-Type"] = "application/octet-stream";
    }
    return base64ToBytes.decode(input.options.bodyBase64 ?? "");
  }

  if (!hasJsonBody) {
    return undefined;
  }

  const body = input.options.body;
  if (typeof body === "string") {
    const hasContentTypeHeader = Object.keys(input.headers).some(
      (key) => key.toLowerCase() === "content-type"
    );
    if (!hasContentTypeHeader) {
      input.headers["Content-Type"] = "text/plain; charset=utf-8";
    }
    return body;
  }

  const hasContentTypeHeader = Object.keys(input.headers).some(
    (key) => key.toLowerCase() === "content-type"
  );
  if (!hasContentTypeHeader) {
    input.headers["Content-Type"] = "application/json";
  }
  return JSON.stringify(body);
}

async function executeGitHubRequest(input: {
  credentials: GitHubCredentials;
  method: string;
  options?: GitHubFetchOptions;
  url: string;
  userAgent?: string;
}): Promise<GitHubRelayResponse> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": input.userAgent ?? "onequery-app",
    "X-GitHub-Api-Version": "2022-11-28",
    ...normalizeGitHubHeaders(input.options?.headers),
  };
  const body = buildGitHubRequestBody({
    headers,
    method: input.method,
    options: input.options,
  });
  const client = new ProviderHttpClient({
    auth: {
      token: input.credentials.accessToken,
      type: "bearer",
    },
    baseUrl: GITHUB_API_BASE_URL,
    blockedParams: BLOCKED_QUERY_PARAM_NAMES,
    providerName: "GitHub",
    sanitize: (text) =>
      parseGitHubErrorDetail(sanitizeGitHubText(text, input.credentials)),
  });
  const response = await client.send({
    body,
    endpoint: input.url,
    headers,
    method: input.method,
    timeoutMs: input.options?.timeoutMs,
  });

  if (response.status === 204) {
    return {};
  }

  const contentType = response.headers.get("content-type");
  if (
    contentType?.includes("application/json") ||
    contentType?.includes("+json")
  ) {
    return (await response.json()) as GitHubRelayResponse;
  }

  if (
    contentType?.startsWith("text/") ||
    contentType?.includes("application/xml") ||
    contentType?.includes("application/x-www-form-urlencoded")
  ) {
    const raw = await response.text().catch(() => "");
    const trimmed = raw.trim();
    return trimmed.length === 0
      ? {}
      : sanitizeGitHubText(raw, input.credentials);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    return {};
  }

  return {
    bodyBase64: base64ToBytes.encode(bytes),
    contentType,
    size: bytes.byteLength,
    type: "binary",
  };
}

export async function fetchGitHubApi(input: {
  credentials: GitHubCredentials;
  endpoint: string;
  options?: GitHubFetchOptions;
  repository?: string;
  userAgent?: string;
}): Promise<GitHubRelayResponse> {
  const method = normalizeGitHubMethod(input.options?.method);
  const url = buildGitHubUrl({
    credentials: input.credentials,
    endpoint: input.endpoint,
    params: input.options?.params,
    repository: input.repository,
  });

  return executeGitHubRequest({
    credentials: input.credentials,
    method,
    options: input.options,
    url,
    userAgent: input.userAgent,
  });
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
