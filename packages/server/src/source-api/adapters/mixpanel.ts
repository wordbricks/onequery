import { isRecord } from "@onequery/base";
import type { MixpanelCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  DEFAULT_MIXPANEL_ENGAGE_PAGE_SIZE,
  MAX_MIXPANEL_ENGAGE_PAGE_SIZE,
} from "../../services/mixpanel/relay";
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
  readSourceApiHttpTransportResponse,
  resolveHttpMethodOverride,
} from "../helpers/http-rest";
import {
  createStructuredRequestOperation,
  mergeStructuredFieldPatch,
} from "../helpers/structured";
import type {
  NormalizedHttpRequestPlan,
  PreparedSourceConnection,
  SourceApiAdapter,
  SourceApiDescriptor,
  SourceApiExample,
  SourceApiExecutionResponse,
  SourceApiJsonValue,
  SourceApiOperation,
  SourceApiRequestBody,
} from "../types";

const MIXPANEL_QUERY_API_BASE_URLS = {
  eu: "https://eu.mixpanel.com/api",
  in: "https://in.mixpanel.com/api",
  us: "https://mixpanel.com/api",
} as const;
const MIXPANEL_EXPORT_API_BASE_URLS = {
  eu: "https://data-eu.mixpanel.com/api/2.0/export",
  in: "https://data-in.mixpanel.com/api/2.0/export",
  us: "https://data.mixpanel.com/api/2.0/export",
} as const;
const MIXPANEL_DESCRIPTOR_VERSION = "mixpanel.v1";
const MIXPANEL_ALLOWED_METHODS = ["DELETE", "GET", "POST", "PUT"] as const;
const MIXPANEL_ALLOWED_METHOD_SET = new Set<string>(MIXPANEL_ALLOWED_METHODS);
const MIXPANEL_ALLOWED_RESPONSE_HEADERS = ["content-type"] as const;
const RESERVED_MIXPANEL_KEYS = new Set(["project_id", "workspace_id"]);

export const mixpanelSourceApiOperationSchema = z.enum([
  "query_engage",
  "query_segmentation",
  "fetch_query_api",
  "export_events",
]);

export type MixpanelSourceApiOperation = z.infer<
  typeof mixpanelSourceApiOperationSchema
>;

const mixpanelEngageRequestSchema = z
  .object({
    outputProperties: z.array(z.string().min(1)).optional(),
    page: z.number().int().min(0).optional(),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(MAX_MIXPANEL_ENGAGE_PAGE_SIZE)
      .optional(),
    where: z.string().min(1).optional(),
  })
  .strict();

const mixpanelSegmentationRequestSchema = z
  .object({
    event: z.string().min(1),
    fromDate: z.string().min(1),
    toDate: z.string().min(1),
    type: z.enum(["general", "unique", "average"]).optional(),
    unit: z.enum(["hour", "day", "week", "month"]).optional(),
    where: z.string().min(1).optional(),
  })
  .strict();

const mixpanelHttpFieldPatchSchema = z
  .object({
    bodyFormat: z.enum(["form", "json"]).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
      .optional(),
  })
  .strict();

const mixpanelFetchOptionsSchema = z.object({
  body: z.record(z.string(), z.unknown()).optional(),
  bodyFormat: z.enum(["form", "json"]).optional(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_PROVIDER_REQUEST_TIMEOUT_MS)
    .optional(),
});

const mixpanelFetchQueryApiRequestSchema = z.object({
  endpoint: z.string().min(1),
  options: mixpanelFetchOptionsSchema.optional(),
});

const mixpanelExportEventsRequestSchema = z.object({
  options: mixpanelFetchOptionsSchema.optional(),
});

type MixpanelEngageRequest = z.infer<typeof mixpanelEngageRequestSchema>;
type MixpanelSegmentationRequest = z.infer<
  typeof mixpanelSegmentationRequestSchema
>;
type MixpanelHttpFieldPatch = z.infer<typeof mixpanelHttpFieldPatchSchema>;
type MixpanelBodyFormat = NonNullable<MixpanelHttpFieldPatch["bodyFormat"]>;

type MixpanelQueryEngageSourceApiRequest = {
  operation: "query_engage";
  request: MixpanelEngageRequest;
};

type MixpanelQuerySegmentationSourceApiRequest = {
  operation: "query_segmentation";
  request: MixpanelSegmentationRequest;
};

type MixpanelFetchQueryApiSourceApiRequest = {
  body: SourceApiRequestBody;
  bodyFormat?: MixpanelBodyFormat;
  method: string;
  operation: "fetch_query_api";
  params?: Record<string, unknown>;
  selector: string;
  timeoutMs?: number;
};

type MixpanelExportEventsSourceApiRequest = {
  body: SourceApiRequestBody;
  bodyFormat?: MixpanelBodyFormat;
  method: string;
  operation: "export_events";
  params?: Record<string, unknown>;
  timeoutMs?: number;
};

export type MixpanelSourceApiRequest =
  | MixpanelQueryEngageSourceApiRequest
  | MixpanelQuerySegmentationSourceApiRequest
  | MixpanelFetchQueryApiSourceApiRequest
  | MixpanelExportEventsSourceApiRequest;

export type MixpanelTransportResponse = Awaited<
  ReturnType<typeof readSourceApiHttpTransportResponse>
>;

export class MixpanelInvalidRequestError extends Error {}

export const mixpanelSourceApiAdapter: SourceApiAdapter = {
  provider: "mixpanel",
  async describe({ source }) {
    const {
      engageExamples,
      examples,
      exportExamples,
      fetchExamples,
      segmentationExamples,
    } = buildMixpanelExamples(source.sourceKey);

    return {
      defaultPathOperation: "fetch_query_api",
      descriptorVersion: MIXPANEL_DESCRIPTOR_VERSION,
      examples,
      notes: [
        "Use higher-level Mixpanel operations first and fall back to `fetch_query_api` only when needed.",
      ],
      operations: [
        createStructuredRequestOperation({
          allowedResponseHeaders: MIXPANEL_ALLOWED_RESPONSE_HEADERS,
          description:
            "Run a Mixpanel Engage query against the connected source.",
          examples: engageExamples,
          name: "query_engage",
          notes: [
            "Use `where`, `page`, `pageSize`, and `outputProperties` to shape the Engage request.",
          ],
          summary: "Query Mixpanel Engage profiles.",
        }),
        createStructuredRequestOperation({
          allowedResponseHeaders: MIXPANEL_ALLOWED_RESPONSE_HEADERS,
          description:
            "Run a Mixpanel segmentation query against the connected source.",
          examples: segmentationExamples,
          name: "query_segmentation",
          notes: [
            "Use `event`, `fromDate`, `toDate`, `type`, `unit`, and `where` to shape the segmentation request.",
          ],
          summary: "Query Mixpanel event segmentation.",
        }),
        createHttpRequestOperation({
          allowedMethods: MIXPANEL_ALLOWED_METHODS,
          allowedResponseHeaders: MIXPANEL_ALLOWED_RESPONSE_HEADERS,
          defaultMethod: "GET",
          description:
            "Call a Mixpanel Query API endpoint for the connected source.",
          examples: fetchExamples,
          name: "fetch_query_api",
          notes: [
            "Selectors must be relative Mixpanel Query API paths.",
            "Pass `bodyFormat=json` when the endpoint expects a JSON request body.",
          ],
          selectorKind: "path",
          selectorLabel: "PATH",
          summary: "Execute one Mixpanel Query API request.",
        }),
        createHttpRequestOperation({
          allowedMethods: MIXPANEL_ALLOWED_METHODS,
          allowedResponseHeaders: MIXPANEL_ALLOWED_RESPONSE_HEADERS,
          defaultMethod: "GET",
          description:
            "Call the Mixpanel export endpoint for the connected source.",
          examples: exportExamples,
          fieldPolicy: {
            mergePatches: false,
          },
          name: "export_events",
          notes: [
            "The export endpoint is fixed; use field patches for params, body format, and timeout only.",
          ],
          selectorKind: "none",
          summary: "Export Mixpanel events.",
        }),
      ],
      source: {
        displayName: source.displayName,
        key: source.sourceKey,
        provider: source.provider,
      },
    };
  },
  async normalize({ descriptor, request, source }) {
    const operation = requireMixpanelSourceApiOperation({
      descriptor,
      operationName: request.operation,
    });

    if (request.pageToken) {
      throw new Error(
        `Mixpanel operation "${operation.name}" does not support page tokens`
      );
    }

    const headers = normalizeAllowedHeaders({
      allowedNames: operation.headerPolicy.allowedRequestHeaders,
      headers: request.headers,
    });

    if (operation.name === "query_engage") {
      if (request.selector?.trim()) {
        throw new Error(
          'Mixpanel operation "query_engage" does not accept a selector'
        );
      }
      if (request.methodOverride?.trim()) {
        throw new Error(
          'Mixpanel operation "query_engage" does not support method overrides'
        );
      }

      return {
        body: request.body,
        descriptorVersion: descriptor.descriptorVersion,
        headers,
        kind: "structured_request",
        operation: operation.name,
        provider: source.provider,
        request: parseMixpanelEngageRequest(
          mergeStructuredFieldPatch({
            base: parseMixpanelStructuredRequestBody(request.body),
            patch: request.fieldPatch,
          })
        ),
        sourceId: source.id,
        sourceKey: source.sourceKey,
      };
    }

    if (operation.name === "query_segmentation") {
      if (request.selector?.trim()) {
        throw new Error(
          'Mixpanel operation "query_segmentation" does not accept a selector'
        );
      }
      if (request.methodOverride?.trim()) {
        throw new Error(
          'Mixpanel operation "query_segmentation" does not support method overrides'
        );
      }

      return {
        body: request.body,
        descriptorVersion: descriptor.descriptorVersion,
        headers,
        kind: "structured_request",
        operation: operation.name,
        provider: source.provider,
        request: parseMixpanelSegmentationRequest(
          mergeStructuredFieldPatch({
            base: parseMixpanelStructuredRequestBody(request.body),
            patch: request.fieldPatch,
          })
        ),
        sourceId: source.id,
        sourceKey: source.sourceKey,
      };
    }

    const fieldPatch = parseMixpanelHttpFieldPatch(request.fieldPatch);
    const method = resolveHttpMethodOverride({
      methodOverride: request.methodOverride,
      policy: operation.methodPolicy,
    });
    if (request.body.kind !== "none" && method === "GET") {
      throw new Error("GET requests cannot include a request body");
    }

    validateMixpanelHttpRequestBody(request.body);

    if (operation.name === "fetch_query_api") {
      const selector = normalizeMixpanelSelector(request.selector);
      return {
        body: request.body,
        descriptorVersion: descriptor.descriptorVersion,
        headers,
        kind: "http_request",
        metadata:
          fieldPatch.bodyFormat === undefined
            ? undefined
            : { bodyFormat: fieldPatch.bodyFormat },
        method,
        operation: operation.name,
        provider: source.provider,
        query: fieldPatch.params,
        selector,
        sourceId: source.id,
        sourceKey: source.sourceKey,
        timeoutMs: fieldPatch.timeoutMs,
        url: buildMixpanelQueryApiUrl({
          credentials: requireMixpanelCredentials(source),
          endpoint: selector,
          params: fieldPatch.params,
        }),
      };
    }

    if (request.selector?.trim()) {
      throw new Error(
        'Mixpanel operation "export_events" does not accept a selector'
      );
    }

    return {
      body: request.body,
      descriptorVersion: descriptor.descriptorVersion,
      headers,
      kind: "http_request",
      metadata:
        fieldPatch.bodyFormat === undefined
          ? undefined
          : { bodyFormat: fieldPatch.bodyFormat },
      method,
      operation: operation.name,
      provider: source.provider,
      query: fieldPatch.params,
      sourceId: source.id,
      sourceKey: source.sourceKey,
      timeoutMs: fieldPatch.timeoutMs,
      url: buildMixpanelExportEventsUrl({
        credentials: requireMixpanelCredentials(source),
        params: fieldPatch.params,
      }),
    };
  },
  async execute({ plan, source }) {
    const credentials = requireMixpanelCredentials(source);

    if (plan.kind === "structured_request") {
      let response: MixpanelTransportResponse;
      switch (plan.operation) {
        case "query_engage":
          response = await requestMixpanelSourceApi({
            credentials,
            operation: "query_engage",
            request: parseMixpanelEngageRequest(plan.request),
          });
          break;
        case "query_segmentation":
          response = await requestMixpanelSourceApi({
            credentials,
            operation: "query_segmentation",
            request: parseMixpanelSegmentationRequest(plan.request),
          });
          break;
        default:
          throw new Error(
            `Mixpanel source API operation "${plan.operation}" requires an HTTP plan`
          );
      }

      return buildMixpanelExecutionResponse({
        operation: plan.operation,
        response,
        source,
      });
    }

    const operation = parseMixpanelSourceApiOperation(plan.operation);
    if (operation === "query_engage" || operation === "query_segmentation") {
      throw new Error(
        `Mixpanel source API operation "${plan.operation}" requires a structured plan`
      );
    }

    const bodyFormat = readMixpanelBodyFormat(plan);
    const response =
      operation === "fetch_query_api"
        ? await requestMixpanelSourceApi({
            body: plan.body,
            bodyFormat,
            credentials,
            method: plan.method,
            operation,
            params: plan.query,
            selector: normalizeMixpanelPlanSelector(plan),
            timeoutMs: plan.timeoutMs,
          })
        : await requestMixpanelSourceApi({
            body: plan.body,
            bodyFormat,
            credentials,
            method: plan.method,
            operation,
            params: plan.query,
            timeoutMs: plan.timeoutMs,
          });

    return buildMixpanelExecutionResponse({
      operation: plan.operation,
      response,
      selector: plan.selector,
      source,
    });
  },
};

export function isMixpanelSourceCredentials(
  value: unknown
): value is MixpanelCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "mixpanel"
  );
}

export function parseMixpanelProviderRouteRequest(input: {
  operation: MixpanelSourceApiOperation;
  request: unknown;
}):
  | { ok: true; data: MixpanelSourceApiRequest }
  | { ok: false; error: string } {
  try {
    switch (input.operation) {
      case "query_engage":
        return {
          data: {
            operation: input.operation,
            request: parseMixpanelEngageRequest(input.request),
          },
          ok: true,
        };
      case "query_segmentation":
        return {
          data: {
            operation: input.operation,
            request: parseMixpanelSegmentationRequest(input.request),
          },
          ok: true,
        };
      case "fetch_query_api": {
        const parsed = mixpanelFetchQueryApiRequestSchema.parse(input.request);
        return {
          data: {
            body: parsed.options?.body
              ? {
                  kind: "json",
                  value: parsed.options.body as SourceApiJsonValue,
                }
              : { kind: "none" },
            bodyFormat: parsed.options?.bodyFormat,
            method: parsed.options?.method ?? "GET",
            operation: input.operation,
            params: parsed.options?.params,
            selector: parsed.endpoint,
            timeoutMs: parsed.options?.timeoutMs,
          },
          ok: true,
        };
      }
      case "export_events": {
        const parsed = mixpanelExportEventsRequestSchema.parse(input.request);
        return {
          data: {
            body: parsed.options?.body
              ? {
                  kind: "json",
                  value: parsed.options.body as SourceApiJsonValue,
                }
              : { kind: "none" },
            bodyFormat: parsed.options?.bodyFormat,
            method: parsed.options?.method ?? "GET",
            operation: input.operation,
            params: parsed.options?.params,
            timeoutMs: parsed.options?.timeoutMs,
          },
          ok: true,
        };
      }
    }
  } catch (error) {
    if (error instanceof MixpanelInvalidRequestError) {
      return { error: error.message, ok: false };
    }
    if (error instanceof z.ZodError) {
      return {
        error:
          input.operation === "query_engage"
            ? "Invalid Mixpanel engage request payload"
            : input.operation === "query_segmentation"
              ? "Invalid Mixpanel segmentation request payload"
              : input.operation === "fetch_query_api"
                ? "Invalid Mixpanel query API request payload"
                : "Invalid Mixpanel export events request payload",
        ok: false,
      };
    }

    throw error;
  }
}

export async function requestMixpanelSourceApi(
  input: {
    credentials: MixpanelCredentials;
  } & (
    | MixpanelQueryEngageSourceApiRequest
    | MixpanelQuerySegmentationSourceApiRequest
    | MixpanelFetchQueryApiSourceApiRequest
    | MixpanelExportEventsSourceApiRequest
  )
): Promise<MixpanelTransportResponse> {
  switch (input.operation) {
    case "query_engage":
      return requestMixpanelQueryApiTransport({
        body: {
          filter_by_cohort: {},
          output_properties:
            input.request.outputProperties &&
            input.request.outputProperties.length > 0
              ? input.request.outputProperties
              : undefined,
          page: normalizeEngagePage(input.request.page),
          page_size: normalizeEngagePageSize(input.request.pageSize),
          where: normalizeOptionalString(input.request.where) ?? undefined,
        },
        bodyFormat: "form",
        credentials: input.credentials,
        endpoint: "/query/engage",
        method: "POST",
      });
    case "query_segmentation": {
      const event = normalizeOptionalString(input.request.event);
      const fromDate = normalizeOptionalString(input.request.fromDate);
      const toDate = normalizeOptionalString(input.request.toDate);
      if (!event) {
        throw new MixpanelInvalidRequestError("event is required");
      }
      if (!fromDate) {
        throw new MixpanelInvalidRequestError("fromDate is required");
      }
      if (!toDate) {
        throw new MixpanelInvalidRequestError("toDate is required");
      }

      return requestMixpanelQueryApiTransport({
        credentials: input.credentials,
        endpoint: "/query/segmentation",
        method: "GET",
        params: {
          event: [event],
          from_date: fromDate,
          to_date: toDate,
          type: input.request.type,
          unit: input.request.unit,
          where: normalizeOptionalString(input.request.where) ?? undefined,
        },
      });
    }
    case "fetch_query_api":
      return requestMixpanelQueryApiTransport({
        body: buildMixpanelHttpRequestBody(input.body),
        bodyFormat: input.bodyFormat ?? "form",
        credentials: input.credentials,
        endpoint: input.selector,
        method: input.method,
        params: input.params,
        timeoutMs: input.timeoutMs,
      });
    case "export_events":
      return requestMixpanelExportEventsTransport({
        body: buildMixpanelHttpRequestBody(input.body),
        bodyFormat: input.bodyFormat ?? "form",
        credentials: input.credentials,
        method: input.method,
        params: input.params,
        timeoutMs: input.timeoutMs,
      });
  }
}

export function buildMixpanelQueryApiUrl(input: {
  credentials: MixpanelCredentials;
  endpoint: string;
  params?: Record<string, unknown>;
}): string {
  const url = new URL(
    `${MIXPANEL_QUERY_API_BASE_URLS[input.credentials.region].replace(/\/+$/, "")}/${normalizeMixpanelSelector(
      input.endpoint
    ).replace(/^\/+/, "")}`
  );
  const params = buildMixpanelParams({
    defaults: {
      project_id: input.credentials.projectId,
      workspace_id: input.credentials.workspaceId,
    },
    params: input.params,
  });

  for (const [key, value] of Object.entries(params ?? {})) {
    const serialized = serializeQueryParam(value);
    if (serialized === null) {
      continue;
    }
    url.searchParams.set(key, serialized);
  }

  return url.toString();
}

export function buildMixpanelExportEventsUrl(input: {
  credentials: MixpanelCredentials;
  params?: Record<string, unknown>;
}): string {
  const url = new URL(MIXPANEL_EXPORT_API_BASE_URLS[input.credentials.region]);
  const params = buildMixpanelParams({
    defaults: {
      project_id: input.credentials.projectId,
    },
    params: input.params,
  });

  for (const [key, value] of Object.entries(params ?? {})) {
    const serialized = serializeQueryParam(value);
    if (serialized === null) {
      continue;
    }
    url.searchParams.set(key, serialized);
  }

  return url.toString();
}

function buildMixpanelExamples(sourceKey: string): {
  engageExamples: SourceApiExample[];
  examples: SourceApiExample[];
  exportExamples: SourceApiExample[];
  fetchExamples: SourceApiExample[];
  segmentationExamples: SourceApiExample[];
} {
  const engageExamples = [
    {
      command: `onequery use --source ${sourceKey} --op query_engage --input '{"where":"properties[\\"plan\\"] == \\"pro\\"","pageSize":100}'`,
      description: "Query Engage profiles with a narrow page size.",
      label: "Query engage",
    },
  ] satisfies SourceApiExample[];
  const segmentationExamples = [
    {
      command: `onequery use --source ${sourceKey} --op query_segmentation --input '{"event":"Signup","fromDate":"2026-03-01","toDate":"2026-03-07","unit":"day"}'`,
      description: "Query Mixpanel event segmentation for one event.",
      label: "Query segmentation",
    },
  ] satisfies SourceApiExample[];
  const fetchExamples = [
    {
      command: `onequery use --source ${sourceKey} /query/events/top -f 'params[type]=general' -f 'params[from_date]=2026-03-01' -f 'params[to_date]=2026-03-07'`,
      description:
        "Call a raw Mixpanel Query API endpoint when the higher-level helpers do not fit.",
      label: "Fetch query API",
    },
  ] satisfies SourceApiExample[];
  const exportExamples = [
    {
      command: `onequery use --source ${sourceKey} --op export_events -f 'params[from_date]=2026-03-01' -f 'params[to_date]=2026-03-07'`,
      description: "Export Mixpanel events for a bounded date range.",
      label: "Export events",
    },
  ] satisfies SourceApiExample[];

  return {
    engageExamples,
    examples: [
      ...engageExamples,
      ...segmentationExamples,
      ...fetchExamples,
      ...exportExamples,
    ],
    exportExamples,
    fetchExamples,
    segmentationExamples,
  };
}

function requireMixpanelSourceApiOperation(input: {
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

function parseMixpanelSourceApiOperation(
  value: string
): MixpanelSourceApiOperation {
  return mixpanelSourceApiOperationSchema.parse(value);
}

function requireMixpanelCredentials(
  source: PreparedSourceConnection
): MixpanelCredentials {
  if (isMixpanelSourceCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error("Mixpanel source credentials are invalid");
}

function parseMixpanelEngageRequest(value: unknown): MixpanelEngageRequest {
  const parsed = mixpanelEngageRequestSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new MixpanelInvalidRequestError(
    "Invalid Mixpanel engage request payload"
  );
}

function parseMixpanelSegmentationRequest(
  value: unknown
): MixpanelSegmentationRequest {
  const parsed = mixpanelSegmentationRequestSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new MixpanelInvalidRequestError(
    "Invalid Mixpanel segmentation request payload"
  );
}

function parseMixpanelHttpFieldPatch(
  value: Record<string, unknown> | undefined
): MixpanelHttpFieldPatch {
  if (!value) {
    return {};
  }

  return mixpanelHttpFieldPatchSchema.parse(value);
}

function parseMixpanelStructuredRequestBody(
  body: SourceApiRequestBody
): Record<string, unknown> {
  switch (body.kind) {
    case "none":
      return {};
    case "json":
      if (!isRecord(body.value)) {
        throw new MixpanelInvalidRequestError(
          "Mixpanel structured requests require a JSON object request body"
        );
      }
      return body.value;
    case "text":
    case "binary":
      throw new MixpanelInvalidRequestError(
        "Mixpanel structured requests require a JSON object request body"
      );
  }
}

function validateMixpanelHttpRequestBody(body: SourceApiRequestBody): void {
  switch (body.kind) {
    case "none":
      return;
    case "json":
      if (!isRecord(body.value)) {
        throw new MixpanelInvalidRequestError(
          "Mixpanel HTTP requests require a JSON object request body"
        );
      }
      return;
    case "text":
    case "binary":
      throw new MixpanelInvalidRequestError(
        "Mixpanel HTTP requests require a JSON object request body"
      );
  }
}

function buildMixpanelHttpRequestBody(
  body: SourceApiRequestBody
): Record<string, unknown> | undefined {
  validateMixpanelHttpRequestBody(body);
  if (body.kind === "none") {
    return undefined;
  }

  return body.value as Record<string, unknown>;
}

function readMixpanelBodyFormat(
  plan: NormalizedHttpRequestPlan
): MixpanelBodyFormat | undefined {
  const bodyFormat = plan.metadata?.bodyFormat;
  return bodyFormat === "form" || bodyFormat === "json"
    ? bodyFormat
    : undefined;
}

function normalizeMixpanelPlanSelector(
  plan: NormalizedHttpRequestPlan
): string {
  const selector = plan.selector?.trim();
  if (selector) {
    return selector;
  }

  throw new Error(
    `Mixpanel source API operation "${plan.operation}" requires a selector`
  );
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeMixpanelMethod(method: string | undefined): string {
  const normalized = (method ?? "GET").toUpperCase();
  if (!MIXPANEL_ALLOWED_METHOD_SET.has(normalized)) {
    throw new MixpanelInvalidRequestError(
      `Unsupported Mixpanel method: ${normalized}`
    );
  }
  return normalized;
}

function normalizeMixpanelSelector(selector: string | undefined): string {
  const trimmed = selector?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new MixpanelInvalidRequestError(
      'Mixpanel operation "fetch_query_api" requires a selector'
    );
  }
  if (
    hasControlCharacters(trimmed) ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    throw new MixpanelInvalidRequestError(
      "Mixpanel selector must not include control characters, query params, or fragments"
    );
  }

  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const pathSegments = normalized
    .split("/")
    .filter((segment) => segment.length > 0);
  if (pathSegments.some((segment) => segment === "." || segment === "..")) {
    throw new MixpanelInvalidRequestError(
      "Mixpanel selector must not contain dot segments"
    );
  }

  return normalized;
}

function assertNoReservedKeys(
  values: Record<string, unknown> | undefined,
  location: "body" | "params"
): void {
  for (const key of Object.keys(values ?? {})) {
    const normalizedKey = key.trim().toLowerCase();
    if (normalizedKey.length === 0) {
      continue;
    }
    if (hasControlCharacters(key)) {
      throw new MixpanelInvalidRequestError(
        `Mixpanel ${location} key "${key}" is invalid`
      );
    }
    if (RESERVED_MIXPANEL_KEYS.has(normalizedKey)) {
      throw new MixpanelInvalidRequestError(
        `Mixpanel ${location} key "${key}" is reserved`
      );
    }
  }
}

function normalizeEngagePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) {
    return DEFAULT_MIXPANEL_ENGAGE_PAGE_SIZE;
  }
  if (!Number.isInteger(pageSize)) {
    throw new MixpanelInvalidRequestError("pageSize must be an integer");
  }
  if (pageSize < 1 || pageSize > MAX_MIXPANEL_ENGAGE_PAGE_SIZE) {
    throw new MixpanelInvalidRequestError(
      `pageSize must be between 1 and ${MAX_MIXPANEL_ENGAGE_PAGE_SIZE}`
    );
  }
  return pageSize;
}

function normalizeEngagePage(page: number | undefined): number {
  if (page === undefined) {
    return 0;
  }
  if (!Number.isInteger(page) || page < 0) {
    throw new MixpanelInvalidRequestError("page must be an integer >= 0");
  }
  return page;
}

function sanitizeMixpanelText(
  text: string,
  credentials: MixpanelCredentials
): string {
  let sanitized = text;
  if (credentials.username.length > 0) {
    sanitized = sanitized.split(credentials.username).join("***");
  }
  if (credentials.secret.length > 0) {
    sanitized = sanitized.split(credentials.secret).join("***");
  }
  return sanitized.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH);
}

function buildMixpanelRequestBody(input: {
  body?: Record<string, unknown>;
  bodyFormat: MixpanelBodyFormat;
  method: string;
}): {
  body?: Record<string, unknown> | string;
  contentType?: string;
} {
  const normalizedMethod = normalizeMixpanelMethod(input.method);
  if (
    !input.body ||
    normalizedMethod === "GET" ||
    normalizedMethod === "HEAD"
  ) {
    return {};
  }
  assertNoReservedKeys(input.body, "body");

  if (input.bodyFormat === "json") {
    return {
      body: input.body,
      contentType: "application/json",
    };
  }

  const formBody = new URLSearchParams();
  for (const [key, value] of Object.entries(input.body)) {
    const serialized = serializeQueryParam(value);
    if (serialized === null) {
      continue;
    }
    formBody.set(key, serialized);
  }

  return {
    body: formBody.toString(),
    contentType: "application/x-www-form-urlencoded",
  };
}

function createMixpanelHttpClient(
  credentials: MixpanelCredentials,
  baseUrl: string
) {
  return new ProviderHttpClient({
    auth: {
      password: credentials.secret,
      type: "basic",
      username: credentials.username,
    },
    baseUrl,
    defaultHeaders: {
      Accept: "application/json",
    },
    providerName: "Mixpanel",
    sanitize: (text) => sanitizeMixpanelText(text, credentials),
  });
}

function buildMixpanelParams(input: {
  defaults?: Record<string, unknown>;
  params?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  assertNoReservedKeys(input.params, "params");
  const params = new Map<string, unknown>();

  for (const [key, value] of Object.entries(input.params ?? {})) {
    params.set(key, value);
  }
  for (const [key, value] of Object.entries(input.defaults ?? {})) {
    if (!params.has(key)) {
      params.set(key, value);
    }
  }

  return Object.fromEntries(params.entries());
}

async function requestMixpanelQueryApiTransport(input: {
  body?: Record<string, unknown>;
  bodyFormat?: MixpanelBodyFormat;
  credentials: MixpanelCredentials;
  endpoint: string;
  method: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<MixpanelTransportResponse> {
  const method = normalizeMixpanelMethod(input.method);
  const requestBody = buildMixpanelRequestBody({
    body: input.body,
    bodyFormat: input.bodyFormat ?? "form",
    method,
  });
  const response = await createMixpanelHttpClient(
    input.credentials,
    MIXPANEL_QUERY_API_BASE_URLS[input.credentials.region]
  ).send({
    body: requestBody.body,
    endpoint: buildMixpanelQueryApiUrl({
      credentials: input.credentials,
      endpoint: input.endpoint,
      params: input.params,
    }),
    headers: requestBody.contentType
      ? { "Content-Type": requestBody.contentType }
      : undefined,
    method,
    timeoutMs: input.timeoutMs,
  });

  return readSourceApiHttpTransportResponse(response);
}

async function requestMixpanelExportEventsTransport(input: {
  body?: Record<string, unknown>;
  bodyFormat?: MixpanelBodyFormat;
  credentials: MixpanelCredentials;
  method: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<MixpanelTransportResponse> {
  const method = normalizeMixpanelMethod(input.method);
  const requestBody = buildMixpanelRequestBody({
    body: input.body,
    bodyFormat: input.bodyFormat ?? "form",
    method,
  });
  const response = await createMixpanelHttpClient(
    input.credentials,
    MIXPANEL_EXPORT_API_BASE_URLS[input.credentials.region]
  ).send({
    body: requestBody.body,
    endpoint: buildMixpanelExportEventsUrl({
      credentials: input.credentials,
      params: input.params,
    }),
    headers: requestBody.contentType
      ? { "Content-Type": requestBody.contentType }
      : undefined,
    method,
    timeoutMs: input.timeoutMs,
  });

  return readSourceApiHttpTransportResponse(response);
}

function buildMixpanelExecutionResponse(input: {
  operation: string;
  response: MixpanelTransportResponse;
  selector?: string;
  source: PreparedSourceConnection;
}): SourceApiExecutionResponse {
  return {
    body: input.response.body,
    contentType: input.response.contentType,
    headers: filterAllowedResponseHeaders({
      allowedNames: MIXPANEL_ALLOWED_RESPONSE_HEADERS,
      contentType: input.response.contentType,
      headers: input.response.headers,
    }),
    operation: input.operation,
    selector: input.selector,
    source: {
      displayName: input.source.displayName,
      key: input.source.sourceKey,
      provider: input.source.provider,
    },
    status: input.response.status,
  };
}
