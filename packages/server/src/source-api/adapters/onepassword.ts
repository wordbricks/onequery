import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import { isRecord } from "@onequery/base";
import type { OnePasswordCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  SourceApiInvalidRequestError,
  SourceApiUnsupportedOperationError,
} from "../errors";
import { canonicalizeSourceApiHeaderPolicy } from "../helpers/header-policy";
import { normalizeAllowedHeaders } from "../helpers/http-rest";
import type {
  PreparedSourceConnection,
  SourceApiAdapter,
  SourceApiDescriptor,
  SourceApiExample,
  SourceApiExecutionResult,
  SourceApiOperation,
  SourceApiRequestBody,
} from "../types";
import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const ONEPASSWORD_CONNECT_DESCRIPTOR_VERSION = "onepassword.v1";
const ONEPASSWORD_SERVICE_ACCOUNT_DESCRIPTOR_VERSION =
  "onepassword.service_account.v1";
const ONEPASSWORD_ALLOWED_RESPONSE_HEADERS = ["content-type"] as const;
const ONEPASSWORD_DEFAULT_INTEGRATION_NAME = "OneQuery";
const ONEPASSWORD_DEFAULT_INTEGRATION_VERSION = "0.0.0";

type OnePasswordConnectCredentials = Extract<
  OnePasswordCredentials,
  { accessToken: string; apiBaseUrl: string }
>;

type OnePasswordServiceAccountCredentials = Extract<
  OnePasswordCredentials,
  { serviceAccountToken: string }
>;

type OnePasswordSdkClient = {
  items: {
    get(vaultId: string, itemId: string): Promise<unknown>;
    list(vaultId: string): Promise<unknown>;
  };
  secrets: {
    resolve(secretReference: string): Promise<string>;
  };
  vaults: {
    list(): Promise<unknown>;
  };
};

type CreateOnePasswordServiceAccountClient = (
  credentials: OnePasswordServiceAccountCredentials
) => Promise<OnePasswordSdkClient>;

type OnePasswordSourceApiAdapterDependencies = {
  createServiceAccountClient?: CreateOnePasswordServiceAccountClient;
};

const onePasswordServiceAccountOperationSchema = z.enum([
  "list_vaults",
  "list_items",
  "get_item",
  "resolve_secret",
]);

type OnePasswordServiceAccountOperation = z.infer<
  typeof onePasswordServiceAccountOperationSchema
>;

class OnePasswordInvalidRequestError extends SourceApiInvalidRequestError {}

const onePasswordConnectSourceApiAdapter =
  createSimpleRestSourceApiAdapter<OnePasswordConnectCredentials>({
    allowedMethods: ["GET"],
    apiBaseUrl: (credentials) => credentials.apiBaseUrl,
    auth: (credentials) => ({
      token: credentials.accessToken,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /v1/vaults`,
        description: "List vaults visible to the connected Connect token.",
        label: "List vaults",
      },
      {
        command: `onequery api --source ${sourceKey} /v1/vaults/<vault-uuid>/items`,
        description: "List items in one vault.",
        label: "List vault items",
      },
      {
        command: `onequery api --source ${sourceKey} /v1/vaults/<vault-uuid>/items/<item-uuid>`,
        description: "Fetch one item from a vault.",
        label: "Get item",
      },
    ],
    descriptorVersion: ONEPASSWORD_CONNECT_DESCRIPTOR_VERSION,
    notes: [
      "1Password requests are sent to the configured Connect Server API base URL with Authorization bearer auth.",
      "Only GET requests are supported. Item and vault mutations are intentionally excluded.",
      "Use `params` in the field patch for Connect API query parameters such as `filter`.",
    ],
    operationNotes: [
      "Selectors should be Connect API paths such as `/v1/vaults` or `/v1/vaults/{vaultUUID}/items`.",
    ],
    provider: "onepassword",
    providerLabel: "1Password",
  });

export function createOnePasswordSourceApiAdapter(
  dependencies: OnePasswordSourceApiAdapterDependencies = {}
): SourceApiAdapter {
  const createServiceAccountClient =
    dependencies.createServiceAccountClient ??
    createDefaultOnePasswordServiceAccountClient;

  return {
    provider: "onepassword",
    async describe({ actor, source }) {
      const credentials = requireOnePasswordCredentials(source);
      if (isOnePasswordServiceAccountCredentials(credentials)) {
        const examples = buildOnePasswordServiceAccountExamples(
          source.sourceKey
        );

        return {
          descriptorVersion: ONEPASSWORD_SERVICE_ACCOUNT_DESCRIPTOR_VERSION,
          examples,
          notes: [
            "1Password Service Account operations use the token saved on the connected source.",
            "Only read-only vault, item, and secret reference operations are exposed.",
            "Use Connect Server credentials only when you need raw Connect REST API paths.",
          ],
          operations: createOnePasswordServiceAccountOperations(examples),
          source: {
            displayName: source.displayName,
            provider: source.provider,
            sourceKey: source.sourceKey,
          },
        };
      }

      return onePasswordConnectSourceApiAdapter.describe({
        actor,
        source:
          source as PreparedSourceConnection<OnePasswordConnectCredentials>,
      });
    },
    async normalize({ actor, descriptor, request, source }) {
      const credentials = requireOnePasswordCredentials(source);
      if (isOnePasswordServiceAccountCredentials(credentials)) {
        return normalizeOnePasswordServiceAccountRequest({
          descriptor,
          request,
          source,
        });
      }

      return onePasswordConnectSourceApiAdapter.normalize({
        actor,
        descriptor,
        request,
        source:
          source as PreparedSourceConnection<OnePasswordConnectCredentials>,
      });
    },
    async execute({ actor, continuation, prepared, source }) {
      const credentials = requireOnePasswordCredentials(source);
      if (isOnePasswordServiceAccountCredentials(credentials)) {
        return executeOnePasswordServiceAccountRequest({
          createServiceAccountClient,
          credentials,
          prepared,
          source,
        });
      }

      return onePasswordConnectSourceApiAdapter.execute({
        actor,
        continuation,
        prepared,
        source:
          source as PreparedSourceConnection<OnePasswordConnectCredentials>,
      });
    },
  };
}

export const onePasswordSourceApiAdapter = createOnePasswordSourceApiAdapter();

function createOnePasswordServiceAccountOperations(
  examples: readonly SourceApiExample[]
): SourceApiOperation[] {
  return [
    createOnePasswordReadOperation({
      description:
        "List vaults visible to the connected 1Password Service Account.",
      examples: examples.filter((example) => example.label === "List vaults"),
      name: "list_vaults",
      selectorKind: "none",
      summary: "List 1Password vaults.",
    }),
    createOnePasswordReadOperation({
      description:
        "List item overviews in one vault visible to the connected 1Password Service Account.",
      examples: examples.filter(
        (example) => example.label === "List vault items"
      ),
      name: "list_items",
      selectorKind: "identifier",
      selectorLabel: "VAULT_ID",
      summary: "List 1Password vault items.",
    }),
    createOnePasswordReadOperation({
      description:
        "Fetch one item from a vault visible to the connected 1Password Service Account.",
      examples: examples.filter((example) => example.label === "Get item"),
      name: "get_item",
      notes: ["Selector format is `<vault-id>/<item-id>`."],
      selectorKind: "path",
      selectorLabel: "VAULT_ID/ITEM_ID",
      summary: "Get one 1Password item.",
    }),
    createOnePasswordReadOperation({
      description:
        "Resolve a 1Password secret reference such as `op://Vault/Item/field`.",
      examples: examples.filter(
        (example) => example.label === "Resolve secret reference"
      ),
      name: "resolve_secret",
      notes: [
        "The selector must be a 1Password secret reference beginning with `op://`.",
      ],
      selectorKind: "identifier",
      selectorLabel: "OP_SECRET_REFERENCE",
      summary: "Resolve one 1Password secret reference.",
    }),
  ];
}

function createOnePasswordReadOperation(input: {
  name: OnePasswordServiceAccountOperation;
  summary: string;
  description: string;
  selectorKind: SourceApiOperation["selectorKind"];
  selectorLabel?: string;
  examples: readonly SourceApiExample[];
  notes?: readonly string[];
}): SourceApiOperation {
  return {
    description: input.description,
    examples: input.examples,
    fieldPolicy: {
      acceptsInput: false,
      allowsRawFields: false,
      allowsTypedFields: false,
      inputMode: "none",
      mergePatches: false,
      supportsArrayPaths: false,
      supportsNestedPaths: false,
    },
    headerPolicy: canonicalizeSourceApiHeaderPolicy({
      allowedRequestHeaders: [],
      allowedResponseHeaders: ONEPASSWORD_ALLOWED_RESPONSE_HEADERS,
    }),
    kind: "structured_request",
    methodPolicy: {
      allowedMethods: ["GET"],
      defaultMethod: "GET",
    },
    name: input.name,
    notes: input.notes ?? [],
    paginationPolicy: "none",
    selectorKind: input.selectorKind,
    selectorLabel: input.selectorLabel,
    summary: input.summary,
  };
}

function buildOnePasswordServiceAccountExamples(
  sourceKey: string
): SourceApiExample[] {
  return [
    {
      command: `onequery api --source ${sourceKey} --op list_vaults`,
      description: "List vaults visible to the Service Account.",
      label: "List vaults",
    },
    {
      command: `onequery api --source ${sourceKey} --op list_items <vault-id>`,
      description: "List item overviews in one vault.",
      label: "List vault items",
    },
    {
      command: `onequery api --source ${sourceKey} --op get_item <vault-id>/<item-id>`,
      description: "Fetch one item with fields from a vault.",
      label: "Get item",
    },
    {
      command: `onequery api --source ${sourceKey} --op resolve_secret 'op://Vault/Item/field'`,
      description: "Resolve one 1Password secret reference.",
      label: "Resolve secret reference",
    },
  ];
}

function normalizeOnePasswordServiceAccountRequest(input: {
  descriptor: SourceApiDescriptor;
  request: {
    operation: string;
    selector?: string;
    methodOverride?: string;
    headers: readonly { name: string; value: string }[];
    fieldPatch?: JsonObject;
    body: SourceApiRequestBody;
  };
  source: PreparedSourceConnection;
}) {
  const operation = requireOnePasswordServiceAccountOperation({
    descriptor: input.descriptor,
    operationName: input.request.operation,
  });

  if (input.request.methodOverride?.trim()) {
    throw new OnePasswordInvalidRequestError(
      `1Password Service Account operation "${operation}" does not support method overrides`
    );
  }
  if (input.request.body.kind !== "none") {
    throw new OnePasswordInvalidRequestError(
      `1Password Service Account operation "${operation}" does not accept a request body`
    );
  }
  if (
    input.request.fieldPatch &&
    Object.keys(input.request.fieldPatch).length > 0
  ) {
    throw new OnePasswordInvalidRequestError(
      `1Password Service Account operation "${operation}" does not accept field patches`
    );
  }

  const headers = normalizeAllowedHeaders({
    allowedNames: [],
    headers: input.request.headers,
  });
  const normalizedRequest = buildOnePasswordServiceAccountPreparedRequest({
    operation,
    selector: input.request.selector,
  });

  return {
    body: input.request.body,
    descriptorVersion: input.descriptor.descriptorVersion,
    headers,
    kind: "structured_request" as const,
    method: "GET",
    operation,
    paginationPolicy: "none" as const,
    provider: input.source.provider,
    request: normalizedRequest.request,
    selector: normalizedRequest.selector,
    selectorTemplate: normalizedRequest.selectorTemplate,
    sourceId: input.source.id,
    sourceKey: input.source.sourceKey,
  };
}

function buildOnePasswordServiceAccountPreparedRequest(input: {
  operation: OnePasswordServiceAccountOperation;
  selector?: string;
}): { request: JsonObject; selector?: string; selectorTemplate?: string } {
  switch (input.operation) {
    case "list_vaults":
      return {
        request: {},
        selector: normalizeEmptyOnePasswordSelector({
          operation: input.operation,
          selector: input.selector,
        }),
      };
    case "list_items": {
      const vaultId = normalizeRequiredOnePasswordSelector({
        label: "vault ID",
        operation: input.operation,
        selector: input.selector,
      });
      return {
        request: { vaultId },
        selector: vaultId,
        selectorTemplate: "vaults/{vaultId}/items",
      };
    }
    case "get_item": {
      const selector = normalizeRequiredOnePasswordSelector({
        label: "vault ID and item ID",
        operation: input.operation,
        selector: input.selector,
      });
      const parts = selector.split("/");
      if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
        throw new OnePasswordInvalidRequestError(
          '1Password Service Account operation "get_item" expects selector format `<vault-id>/<item-id>`'
        );
      }
      const [vaultId, itemId] = parts;
      return {
        request: { itemId, vaultId },
        selector,
        selectorTemplate: "vaults/{vaultId}/items/{itemId}",
      };
    }
    case "resolve_secret": {
      const reference = normalizeRequiredOnePasswordSelector({
        label: "secret reference",
        operation: input.operation,
        selector: input.selector,
      });
      if (!reference.startsWith("op://")) {
        throw new OnePasswordInvalidRequestError(
          '1Password Service Account operation "resolve_secret" expects an `op://` secret reference selector'
        );
      }
      return {
        request: { reference },
        selector: reference,
        selectorTemplate: "op://{vault}/{item}/{field}",
      };
    }
  }
}

async function executeOnePasswordServiceAccountRequest(input: {
  createServiceAccountClient: CreateOnePasswordServiceAccountClient;
  credentials: OnePasswordServiceAccountCredentials;
  prepared: Parameters<SourceApiAdapter["execute"]>[0]["prepared"];
  source: PreparedSourceConnection;
}): Promise<SourceApiExecutionResult> {
  if (input.prepared.kind !== "structured_request") {
    throw new Error(
      `1Password Service Account operation "${input.prepared.operation}" requires a structured plan`
    );
  }

  const operation = parseOnePasswordServiceAccountOperation(
    input.prepared.operation
  );
  const client = await input.createServiceAccountClient(input.credentials);
  const value = await executeOnePasswordServiceAccountOperation({
    client,
    operation,
    request: input.prepared.request,
  });

  return {
    body: {
      kind: "json",
      value: toJsonValue(value),
    },
    contentType: "application/json",
    headers: [{ name: "content-type", value: "application/json" }],
    operation: input.prepared.operation,
    selector: input.prepared.selector,
    source: {
      displayName: input.source.displayName,
      provider: input.source.provider,
      sourceKey: input.source.sourceKey,
    },
    status: 200,
  } satisfies SourceApiExecutionResult;
}

async function executeOnePasswordServiceAccountOperation(input: {
  client: OnePasswordSdkClient;
  operation: OnePasswordServiceAccountOperation;
  request: JsonObject;
}): Promise<unknown> {
  switch (input.operation) {
    case "list_vaults":
      return input.client.vaults.list();
    case "list_items":
      return input.client.items.list(
        requirePreparedString(input.request, "vaultId")
      );
    case "get_item":
      return input.client.items.get(
        requirePreparedString(input.request, "vaultId"),
        requirePreparedString(input.request, "itemId")
      );
    case "resolve_secret": {
      const reference = requirePreparedString(input.request, "reference");
      const value = await input.client.secrets.resolve(reference);
      return { reference, value };
    }
  }
}

async function createDefaultOnePasswordServiceAccountClient(
  credentials: OnePasswordServiceAccountCredentials
): Promise<OnePasswordSdkClient> {
  const sdk = (await import("@1password/sdk")) as {
    createClient(input: {
      auth: string;
      integrationName: string;
      integrationVersion: string;
    }): Promise<OnePasswordSdkClient>;
  };

  return sdk.createClient({
    auth: credentials.serviceAccountToken,
    integrationName:
      credentials.integrationName ?? ONEPASSWORD_DEFAULT_INTEGRATION_NAME,
    integrationVersion:
      credentials.integrationVersion ?? ONEPASSWORD_DEFAULT_INTEGRATION_VERSION,
  });
}

function requireOnePasswordCredentials(
  source: PreparedSourceConnection
): OnePasswordCredentials {
  if (
    source.provider === "onepassword" &&
    source.credentials.type === "onepassword"
  ) {
    return source.credentials as OnePasswordCredentials;
  }

  throw new Error("1Password source credentials are invalid");
}

function isOnePasswordServiceAccountCredentials(
  credentials: OnePasswordCredentials
): credentials is OnePasswordServiceAccountCredentials {
  return (
    isRecord(credentials) &&
    "serviceAccountToken" in credentials &&
    typeof credentials.serviceAccountToken === "string" &&
    credentials.serviceAccountToken.trim().length > 0
  );
}

function requireOnePasswordServiceAccountOperation(input: {
  descriptor: SourceApiDescriptor;
  operationName: string;
}): OnePasswordServiceAccountOperation {
  const operation = parseOnePasswordServiceAccountOperation(
    input.operationName
  );
  if (
    input.descriptor.operations.some(
      (candidate) => candidate.name === operation
    )
  ) {
    return operation;
  }

  throw new SourceApiUnsupportedOperationError(input.operationName);
}

function parseOnePasswordServiceAccountOperation(
  operationName: string
): OnePasswordServiceAccountOperation {
  const result = onePasswordServiceAccountOperationSchema.safeParse(
    operationName.trim()
  );
  if (result.success) {
    return result.data;
  }

  throw new SourceApiUnsupportedOperationError(operationName);
}

function normalizeEmptyOnePasswordSelector(input: {
  operation: OnePasswordServiceAccountOperation;
  selector?: string;
}): undefined {
  if (input.selector?.trim()) {
    throw new OnePasswordInvalidRequestError(
      `1Password Service Account operation "${input.operation}" does not accept a selector`
    );
  }

  return undefined;
}

function normalizeRequiredOnePasswordSelector(input: {
  operation: OnePasswordServiceAccountOperation;
  label: string;
  selector?: string;
}): string {
  const selector = input.selector?.trim();
  if (selector) {
    return selector;
  }

  throw new OnePasswordInvalidRequestError(
    `1Password Service Account operation "${input.operation}" requires a ${input.label} selector`
  );
}

function requirePreparedString(request: JsonObject, key: string): string {
  const value = request[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new OnePasswordInvalidRequestError(
    `1Password Service Account prepared request is missing "${key}"`
  );
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return typeof value === "number" && !Number.isFinite(value) ? null : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry === undefined ||
      typeof entry === "function" ||
      typeof entry === "symbol"
        ? null
        : toJsonValue(entry)
    );
  }

  if (isRecord(value)) {
    const toJSON = value.toJSON;
    if (typeof toJSON === "function") {
      return toJsonValue(toJSON.call(value));
    }

    const result: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        entry === undefined ||
        typeof entry === "function" ||
        typeof entry === "symbol"
      ) {
        continue;
      }
      result[key] = toJsonValue(entry);
    }
    return result;
  }

  throw new Error("1Password SDK response must be JSON-serializable");
}
