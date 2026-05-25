import { base64ToUtf8 } from "@onequery/codecs/base64";

import { normalizeProviderRequestTimeout } from "./provider-http";
import { serializeQueryParam } from "./provider-utils";

type ProviderAuth =
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string }
  | { type: "raw"; value: string };

interface ProviderHttpClientOptions {
  auth: ProviderAuth;
  baseUrl: string;
  blockedParams?: ReadonlySet<string>;
  defaultHeaders?: Record<string, string>;
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  providerName: string;
  sanitize?: (text: string) => string;
}

interface ProviderHttpRequestOptions {
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
  endpoint: string;
  headers?: Record<string, string>;
  method?: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Provider base URL must use http or https");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("Provider base URL must not include URL credentials");
  }
  return url.toString().replace(/\/+$/, "");
}

function createAuthHeader(auth: ProviderAuth): string {
  if (auth.type === "bearer") {
    return `Bearer ${auth.token}`;
  }
  if (auth.type === "raw") {
    return auth.value;
  }

  return `Basic ${base64ToUtf8.encode(`${auth.username}:${auth.password}`)}`;
}

function isRawBody(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof ArrayBuffer ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof Uint8Array ||
    value instanceof ReadableStream
  );
}

function isRecordLike(
  value: unknown
): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

export class ProviderHttpClient {
  readonly #auth: ProviderAuth;
  readonly #baseUrl: string;
  readonly #blockedParams: ReadonlySet<string>;
  readonly #defaultHeaders: Record<string, string>;
  readonly #defaultTimeoutMs: number;
  readonly #fetchImpl: typeof fetch;
  readonly #providerName: string;
  readonly #sanitize: (text: string) => string;

  constructor(options: ProviderHttpClientOptions) {
    this.#auth = options.auth;
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#blockedParams = options.blockedParams ?? new Set<string>();
    this.#defaultHeaders = options.defaultHeaders ?? {};
    this.#defaultTimeoutMs = normalizeProviderRequestTimeout(
      options.defaultTimeoutMs
    );
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#providerName = options.providerName;
    this.#sanitize = options.sanitize ?? ((text) => text);
  }

  async delete(endpoint: string, timeoutMs?: number): Promise<unknown> {
    return this.request({ endpoint, method: "DELETE", timeoutMs });
  }

  async get(
    endpoint: string,
    params?: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<unknown> {
    return this.request({ endpoint, method: "GET", params, timeoutMs });
  }

  async post(
    endpoint: string,
    body?: unknown,
    timeoutMs?: number
  ): Promise<unknown> {
    return this.request({
      body: body as ProviderHttpRequestOptions["body"],
      endpoint,
      method: "POST",
      timeoutMs,
    });
  }

  async put(
    endpoint: string,
    body?: unknown,
    timeoutMs?: number
  ): Promise<unknown> {
    return this.request({
      body: body as ProviderHttpRequestOptions["body"],
      endpoint,
      method: "PUT",
      timeoutMs,
    });
  }

  async request(input: ProviderHttpRequestOptions): Promise<unknown> {
    const response = await this.send(input);
    if (response.status === 204) {
      return {};
    }

    const raw = await response.text().catch(() => "");
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return {};
    }

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return this.#sanitize(raw);
    }
  }

  async send(input: ProviderHttpRequestOptions): Promise<Response> {
    const timeoutMs = normalizeProviderRequestTimeout(
      input.timeoutMs ?? this.#defaultTimeoutMs
    );
    const url = this.#buildUrl(input.endpoint, input.params);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = {
        ...this.#defaultHeaders,
        ...input.headers,
        Authorization: createAuthHeader(this.#auth),
      };
      const body = this.#createBody(input.body, headers);
      const response = await this.#fetchImpl(url, {
        body,
        headers,
        method: (input.method ?? "GET").toUpperCase(),
        signal: controller.signal,
      });

      if (!response.ok) {
        const rawError = await response.text().catch(() => "Unknown error");
        const detail = this.#sanitize(rawError);
        throw new Error(
          `${this.#providerName} API error (${response.status}): ${detail}`
        );
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `${this.#providerName} request timeout after ${timeoutMs}ms`,
          {
            cause: error,
          }
        );
      }

      if (error instanceof Error) {
        throw new TypeError(this.#sanitize(error.message), {
          cause: error,
        });
      }

      throw new Error(this.#sanitize(String(error)), { cause: error });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  #buildUrl(
    endpoint: string,
    params: Record<string, unknown> | undefined
  ): URL {
    const normalizedEndpoint = endpoint.trim();
    if (normalizedEndpoint.length === 0) {
      throw new Error("endpoint is required");
    }

    const url =
      normalizedEndpoint.startsWith("http://") ||
      normalizedEndpoint.startsWith("https://")
        ? new URL(normalizedEndpoint)
        : new URL(
            normalizedEndpoint.startsWith("/")
              ? normalizedEndpoint
              : `/${normalizedEndpoint}`,
            `${this.#baseUrl}/`
          );

    if (url.username.length > 0 || url.password.length > 0) {
      throw new Error("Provider endpoint must not include URL credentials");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Provider endpoint must use http or https");
    }

    for (const key of url.searchParams.keys()) {
      if (this.#blockedParams.has(key.toLowerCase())) {
        throw new Error(`Provider request param "${key}" is not allowed`);
      }
    }

    for (const [key, value] of Object.entries(params ?? {})) {
      if (this.#blockedParams.has(key.toLowerCase())) {
        throw new Error(`Provider request param "${key}" is not allowed`);
      }

      const serialized = serializeQueryParam(value);
      if (serialized === null) {
        continue;
      }
      url.searchParams.set(key, serialized);
    }

    return url;
  }

  #createBody(
    body: ProviderHttpRequestOptions["body"],
    headers: Record<string, string>
  ) {
    if (body === undefined || body === null) {
      return undefined;
    }

    if (isRawBody(body)) {
      return body;
    }

    if (isRecordLike(body)) {
      if (!hasHeader(headers, "Content-Type")) {
        headers["Content-Type"] = "application/json";
      }
      return JSON.stringify(body);
    }

    return String(body);
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerName);
}
