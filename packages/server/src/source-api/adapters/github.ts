import { base64ToBytes } from "@onequery/codecs/base64";
import type { GitHubCredentials } from "@onequery/db/server";
import { isGitHubCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  MAX_PROVIDER_ERROR_DETAIL_LENGTH,
  MAX_PROVIDER_REQUEST_TIMEOUT_MS,
} from "../../services/provider-http";
import { ProviderHttpClient } from "../../services/provider-http-client";
import {
  hasControlCharacters,
  serializeQueryParam,
} from "../../services/provider-utils";
import {
  createHttpRequestOperation,
  filterAllowedResponseHeaders,
  normalizeAllowedHeaders,
  normalizeSourceApiContentType,
  resolveHttpMethodOverride,
  toHeaderRecord,
} from "../helpers/http-rest";
import type {
  NormalizedHttpRequestPlan,
  PreparedSourceConnection,
  SourceApiAdapter,
  SourceApiExample,
  SourceApiHeader,
  SourceApiJsonValue,
  SourceApiOperation,
  SourceApiRequestBody,
  SourceApiResponseBody,
  SourceApiDescriptor,
} from "../types";

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_UPLOADS_API_BASE_URL = "https://uploads.github.com";
const GITHUB_DESCRIPTOR_VERSION = "github.v1";
const GITHUB_ALLOWED_METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "PATCH",
  "POST",
  "PUT",
] as const;
const GITHUB_ALLOWED_REQUEST_HEADERS = [
  "Accept",
  "Content-Type",
  "If-Match",
  "If-Modified-Since",
  "If-None-Match",
  "If-Unmodified-Since",
  "X-GitHub-Api-Version",
] as const;
const GITHUB_ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "etag",
  "link",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
] as const;
const BLOCKED_QUERY_PARAM_NAMES = new Set([
  "access_token",
  "authorization",
  "client_secret",
]);
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

export const DEFAULT_GITHUB_REPOSITORIES_QUERY_PARAMS = {
  affiliation: "owner,collaborator,organization_member",
  direction: "desc",
  per_page: 100,
  sort: "updated",
} as const;

const GitHubFieldPatchSchema = z
  .object({
    params: z.record(z.string(), z.unknown()).optional(),
    repository: z.string().min(1).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
      .optional(),
  })
  .strict();

type GitHubFieldPatch = z.infer<typeof GitHubFieldPatchSchema>;

export type GitHubTransportResponse = {
  body: SourceApiResponseBody;
  contentType: string;
  headers: SourceApiHeader[];
  status: number;
};

export const githubSourceApiAdapter: SourceApiAdapter = {
  provider: "github",
  async describe({ source }) {
    const examples = buildGitHubExamples(source.sourceKey);

    return {
      defaultPathOperation: "fetch",
      descriptorVersion: GITHUB_DESCRIPTOR_VERSION,
      examples,
      notes: [
        "Repo-scoped selectors like `/issues` require exactly one connected repository unless `repository` is passed in the field patch.",
        "Explicit `/repos/<owner>/<repo>/...` selectors must target a repository already connected to this source.",
      ],
      operations: [
        createHttpRequestOperation({
          allowedMethods: GITHUB_ALLOWED_METHODS,
          allowedRequestHeaders: GITHUB_ALLOWED_REQUEST_HEADERS,
          allowedResponseHeaders: GITHUB_ALLOWED_RESPONSE_HEADERS,
          defaultMethod: "GET",
          description:
            "Call the GitHub REST API for the connected source, using source-scoped repository constraints and safe request normalization.",
          examples,
          name: "fetch",
          notes: [
            "Use `params` in the field patch for query string values.",
            "Use the request body for JSON, text, or binary payloads.",
          ],
          selectorKind: "path",
          selectorLabel: "PATH_OR_URL",
          summary: "Execute one GitHub REST request.",
        }),
      ],
      source: {
        displayName: source.displayName,
        key: source.sourceKey,
        provider: source.provider,
      },
    };
  },
  async execute({ plan, source }) {
    if (plan.kind !== "http_request") {
      throw new Error(
        `GitHub source API operation "${plan.operation}" requires an HTTP plan`
      );
    }

    const response = await requestGitHubApi({
      body: plan.body,
      credentials: requireGitHubCredentials(source),
      headers: toHeaderRecord(plan.headers),
      method: plan.method,
      timeoutMs: readGitHubTimeoutMs(plan),
      url: plan.url,
    });

    return {
      body: response.body,
      contentType: response.contentType,
      headers: filterAllowedResponseHeaders({
        allowedNames: GITHUB_ALLOWED_RESPONSE_HEADERS,
        contentType: response.contentType,
        headers: response.headers,
      }),
      operation: plan.operation,
      selector: plan.selector,
      source: {
        displayName: source.displayName,
        key: source.sourceKey,
        provider: source.provider,
      },
      status: response.status,
    };
  },
  async normalize({ descriptor, request, source }) {
    const operation = requireGitHubSourceApiOperation({
      descriptor,
      operationName: request.operation,
    });
    if (request.pageToken) {
      throw new Error('GitHub operation "fetch" does not support page tokens');
    }

    const selector = request.selector?.trim();
    if (!selector) {
      throw new Error('GitHub operation "fetch" requires a selector');
    }

    const fieldPatch = parseGitHubFieldPatch(request.fieldPatch);
    const method = resolveHttpMethodOverride({
      methodOverride: request.methodOverride,
      policy: operation.methodPolicy,
    });
    if (
      request.body.kind !== "none" &&
      (method === "GET" || method === "HEAD")
    ) {
      throw new Error("GET and HEAD requests cannot include a request body");
    }

    const headers = normalizeAllowedHeaders({
      allowedNames: operation.headerPolicy.allowedRequestHeaders,
      headers: request.headers,
    });
    const url = buildGitHubUrl({
      credentials: requireGitHubCredentials(source),
      endpoint: selector,
      params: fieldPatch.params,
      repository: fieldPatch.repository,
    });

    return {
      body: request.body,
      descriptorVersion: descriptor.descriptorVersion,
      headers,
      kind: "http_request",
      metadata:
        fieldPatch.timeoutMs === undefined
          ? undefined
          : { timeoutMs: fieldPatch.timeoutMs },
      method,
      operation: operation.name,
      provider: source.provider,
      selector,
      sourceId: source.id,
      sourceKey: source.sourceKey,
      url,
    };
  },
};

export function buildGitHubUrl(input: {
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
          ? "multiple repositories are connected; pass repository as <owner>/<repo>"
          : "repo-scoped selectors require repository or an explicit /repos/<owner>/<repo> path"
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
        `repository (${requestedRepository}) does not match selector repository (${urlRepository})`
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

export async function requestGitHubApi(input: {
  body: SourceApiRequestBody;
  credentials: GitHubCredentials;
  headers?: Record<string, string>;
  method: string;
  timeoutMs?: number;
  url: string;
  userAgent?: string;
}): Promise<GitHubTransportResponse> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": input.userAgent ?? "onequery-app",
    "X-GitHub-Api-Version": "2022-11-28",
    ...normalizeGitHubHeaders(input.headers),
  };
  const body = buildGitHubRequestBody({
    body: input.body,
    headers,
    method: input.method,
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
    timeoutMs: input.timeoutMs,
  });
  const contentType = normalizeSourceApiContentType(
    response.headers.get("content-type")
  );
  const bytes = new Uint8Array(await response.arrayBuffer());

  return {
    body: parseGitHubResponseBody({
      bytes,
      contentType,
      credentials: input.credentials,
      status: response.status,
    }),
    contentType,
    headers: Array.from(response.headers.entries()).map(([name, value]) => ({
      name,
      value,
    })),
    status: response.status,
  };
}

export function toLegacyGitHubRelayBody(
  input: GitHubTransportResponse
): Record<string, unknown> | unknown[] | string | number | boolean | null {
  switch (input.body.kind) {
    case "none":
      return {};
    case "json":
      return input.body.value;
    case "text":
      return input.body.value;
    case "binary":
      return {
        bodyBase64: base64ToBytes.encode(new Uint8Array(input.body.value)),
        contentType: input.contentType || null,
        size: input.body.value.byteLength,
        type: "binary",
      };
  }
}

function buildGitHubExamples(sourceKey: string): SourceApiExample[] {
  return [
    {
      command: `onequery use --source ${sourceKey} /issues -f 'params[state]=open'`,
      description:
        "Fetch repo-scoped issues for the connected repository selection.",
      label: "List open issues",
    },
    {
      command: `onequery use --source ${sourceKey} --op fetch /repos/openai/example/pulls -f 'params[per_page]=20'`,
      description:
        "Call an explicit repository path when multiple repositories are connected.",
      label: "List pull requests",
    },
  ];
}

function requireGitHubSourceApiOperation(input: {
  descriptor: SourceApiDescriptor;
  operationName: string;
}): SourceApiOperation {
  const operation = input.descriptor.operations.find(
    (candidate) => candidate.name === input.operationName.trim()
  );
  if (operation) {
    return operation;
  }

  throw new Error(`Unsupported source API operation: ${input.operationName}`);
}

function parseGitHubFieldPatch(
  value: Record<string, unknown> | undefined
): GitHubFieldPatch {
  if (!value) {
    return {};
  }

  return GitHubFieldPatchSchema.parse(value);
}

function requireGitHubCredentials(
  source: PreparedSourceConnection
): GitHubCredentials {
  if (isGitHubCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error("GitHub source credentials are invalid");
}

function readGitHubTimeoutMs(
  plan: NormalizedHttpRequestPlan
): number | undefined {
  const timeoutMs = plan.metadata?.timeoutMs;
  return typeof timeoutMs === "number" ? timeoutMs : undefined;
}

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
  body: SourceApiRequestBody;
  headers: Record<string, string>;
  method: string;
}): BodyInit | undefined {
  if (input.body.kind === "none") {
    return undefined;
  }

  if (
    (input.body.kind === "json" ||
      input.body.kind === "text" ||
      input.body.kind === "binary") &&
    (input.method === "GET" || input.method === "HEAD")
  ) {
    throw new Error("GET and HEAD requests cannot include a request body");
  }

  if (input.body.kind === "binary") {
    ensureDefaultContentType(input.headers, "application/octet-stream");
    return new Uint8Array(input.body.value);
  }

  if (input.body.kind === "text") {
    ensureDefaultContentType(input.headers, "text/plain; charset=utf-8");
    return input.body.value;
  }

  ensureDefaultContentType(input.headers, "application/json");
  return JSON.stringify(input.body.value);
}

function ensureDefaultContentType(
  headers: Record<string, string>,
  contentType: string
) {
  const hasContentTypeHeader = Object.keys(headers).some(
    (key) => key.toLowerCase() === "content-type"
  );
  if (!hasContentTypeHeader) {
    headers["Content-Type"] = contentType;
  }
}

function parseGitHubResponseBody(input: {
  bytes: Uint8Array;
  contentType: string;
  credentials: GitHubCredentials;
  status: number;
}): SourceApiResponseBody {
  if (input.status === 204 || input.bytes.length === 0) {
    return { kind: "none" };
  }

  if (
    input.contentType.includes("application/json") ||
    input.contentType.includes("+json")
  ) {
    const text = new TextDecoder().decode(input.bytes);
    if (text.trim().length === 0) {
      return { kind: "none" };
    }

    return {
      kind: "json",
      value: JSON.parse(text) as SourceApiJsonValue,
    };
  }

  if (
    input.contentType.startsWith("text/") ||
    input.contentType.includes("application/xml") ||
    input.contentType.includes("application/x-www-form-urlencoded")
  ) {
    const text = sanitizeGitHubText(
      new TextDecoder().decode(input.bytes),
      input.credentials
    );
    if (text.trim().length === 0) {
      return { kind: "none" };
    }

    return {
      kind: "text",
      value: text,
    };
  }

  return {
    kind: "binary",
    value: input.bytes,
  };
}
