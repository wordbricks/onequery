import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import { isRecord } from "@onequery/base";
import type { SlackCredentials } from "@onequery/db/server";
import { z } from "zod";

import {
  SourceApiInvalidRequestError,
  SourceApiUnsupportedOperationError,
} from "../errors";
import {
  filterAllowedResponseHeaders,
  normalizeAllowedHeaders,
} from "../helpers/http-rest";
import {
  createStructuredRequestOperation,
  mergeStructuredFieldPatch,
} from "../helpers/structured";
import type {
  PreparedSourceConnection,
  SourceApiAdapter,
  SourceApiDescriptor,
  SourceApiExample,
  SourceApiExecutionResult,
  SourceApiOperation,
  SourceApiRequestBody,
} from "../types";

const SLACK_DESCRIPTOR_VERSION = "slack.v2";
const SLACK_API_BASE_URL = "https://slack.com/api";
const SLACK_ALLOWED_RESPONSE_HEADERS = ["content-type"] as const;
const SLACK_CHAT_WRITE_SCOPE = "chat:write";
const CHANNEL_ID_PATTERN = /^[CDG][A-Z0-9]+$/;

const slackOperationSchema = z.enum([
  "list_channels",
  "fetch_channel_history",
  "fetch_thread_replies",
  "send_message",
]);

type SlackOperation = z.infer<typeof slackOperationSchema>;

const slackBaseRequestSchema = z
  .object({
    cursor: z.string().trim().min(1).optional(),
    inclusive: z.boolean().optional(),
    latest: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    oldest: z.string().trim().min(1).optional(),
  })
  .loose();

const slackListChannelsRequestSchema = slackBaseRequestSchema.extend({
  exclude_archived: z.boolean().optional(),
  types: z.string().trim().min(1).optional(),
});

const slackChannelHistoryRequestSchema = slackBaseRequestSchema;

const slackThreadRepliesRequestSchema = slackBaseRequestSchema.extend({
  thread_ts: z.string().trim().min(1).optional(),
  ts: z.string().trim().min(1).optional(),
});

const slackSendMessageRequestSchema = z
  .object({
    blocks: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
    text: z.string().min(1).max(40_000),
    thread_ts: z.string().trim().min(1).optional(),
  })
  .strict();

type SlackRequest = z.infer<typeof slackBaseRequestSchema> &
  Partial<z.infer<typeof slackSendMessageRequestSchema>> &
  Record<string, unknown>;

class SlackInvalidRequestError extends SourceApiInvalidRequestError {}

type SlackApiResponse = {
  body: { kind: "json"; value: JsonValue };
  contentType: string;
  headers: [];
  status: number;
};

export const slackSourceApiAdapter: SourceApiAdapter = {
  provider: "slack",
  async describe({ source }) {
    const credentials = requireSlackCredentials(source);
    const canSendMessages = canSlackSendMessages(credentials);
    const examples = buildSlackExamples(source.sourceKey, canSendMessages);
    const notes = [
      "Slack returns only channels and messages the installed app can access.",
      "Invite the Slack app to private channels before querying them or sending messages.",
      "Use Slack timestamps as strings for oldest, latest, and thread ts values.",
    ];
    if (!canSendMessages) {
      notes.push(
        "This Slack connection cannot send messages because it does not have the chat:write bot scope."
      );
    }

    return {
      descriptorVersion: SLACK_DESCRIPTOR_VERSION,
      examples,
      notes,
      operations: [
        createStructuredRequestOperation({
          allowedResponseHeaders: SLACK_ALLOWED_RESPONSE_HEADERS,
          description:
            "List public and private Slack channels visible to the installed app. Optional fields: types, limit, cursor, exclude_archived.",
          examples: examples.filter(
            (example) => example.label === "List channels"
          ),
          fieldPolicy: {
            supportsArrayPaths: false,
            supportsNestedPaths: false,
          },
          name: "list_channels",
          notes: [
            "Defaults to `public_channel,private_channel` and excludes archived channels.",
          ],
          summary: "List Slack channels.",
        }),
        createStructuredRequestOperation({
          allowedResponseHeaders: SLACK_ALLOWED_RESPONSE_HEADERS,
          description:
            "Fetch recent Slack messages from one channel. Selector may be a channel ID or #channel-name. Optional fields: limit, cursor, oldest, latest, inclusive.",
          examples: examples.filter(
            (example) => example.label === "Fetch channel history"
          ),
          fieldPolicy: {
            supportsArrayPaths: false,
            supportsNestedPaths: false,
          },
          name: "fetch_channel_history",
          selectorKind: "path",
          selectorLabel: "CHANNEL",
          summary: "Fetch Slack channel history.",
        }),
        createStructuredRequestOperation({
          allowedResponseHeaders: SLACK_ALLOWED_RESPONSE_HEADERS,
          description:
            "Fetch replies from a Slack thread. Selector may be a channel ID or #channel-name. Required field: ts or thread_ts. Optional fields: limit, cursor, oldest, latest, inclusive.",
          examples: examples.filter(
            (example) => example.label === "Fetch thread replies"
          ),
          fieldPolicy: {
            supportsArrayPaths: false,
            supportsNestedPaths: false,
          },
          name: "fetch_thread_replies",
          selectorKind: "path",
          selectorLabel: "CHANNEL",
          summary: "Fetch Slack thread replies.",
        }),
        ...(canSendMessages
          ? [
              createStructuredRequestOperation({
                allowedResponseHeaders: SLACK_ALLOWED_RESPONSE_HEADERS,
                description:
                  "Send a Slack message to one channel. Selector may be a channel ID or #channel-name. Required field: text. Optional fields: blocks and thread_ts.",
                examples: examples.filter(
                  (example) => example.label === "Send message"
                ),
                fieldPolicy: {
                  supportsArrayPaths: true,
                  supportsNestedPaths: true,
                },
                name: "send_message",
                notes: [
                  "This operation writes to Slack and requires the chat:write bot scope.",
                ],
                selectorKind: "path",
                selectorLabel: "CHANNEL",
                summary: "Send a Slack message.",
              }),
            ]
          : []),
      ],
      source: {
        displayName: source.displayName,
        provider: source.provider,
        sourceKey: source.sourceKey,
      },
    };
  },
  async normalize({ descriptor, request, source }) {
    const operation = requireSlackOperation({
      descriptor,
      operationName: request.operation,
    });
    const credentials = requireSlackCredentials(source);
    if (operation.name === "send_message") {
      assertSlackCanSendMessages(credentials);
    }

    if (request.methodOverride?.trim()) {
      throw new SlackInvalidRequestError(
        `Slack operation "${operation.name}" does not support method overrides`
      );
    }

    const headers = normalizeAllowedHeaders({
      allowedNames: operation.headerPolicy.allowedRequestHeaders,
      headers: request.headers,
    });
    const normalizedRequest = parseSlackRequest({
      operation: operation.name,
      value: mergeStructuredFieldPatch({
        base: parseSlackRequestBody(request.body),
        patch: request.fieldPatch,
      }),
    });
    const selector = normalizeSlackSelector({
      operation: operation.name,
      selector: request.selector,
    });

    return {
      body: request.body,
      descriptorVersion: descriptor.descriptorVersion,
      headers,
      kind: "structured_request",
      method: "POST",
      operation: operation.name,
      paginationPolicy: operation.paginationPolicy,
      provider: source.provider,
      request: normalizedRequest as JsonObject,
      selector,
      selectorTemplate: selector ? "channels/{channel}" : undefined,
      sourceId: source.id,
      sourceKey: source.sourceKey,
    };
  },
  async execute({ prepared, source }) {
    if (prepared.kind !== "structured_request") {
      throw new Error(
        `Slack source API operation "${prepared.operation}" requires a structured plan`
      );
    }

    const operation = parseSlackOperation(prepared.operation);
    const request = parseSlackRequest({
      operation,
      value: prepared.request,
    });
    const credentials = requireSlackCredentials(source);
    const response = await executeSlackOperation({
      credentials,
      operation,
      request,
      selector: prepared.selector,
    });

    return {
      body: response.body,
      contentType: response.contentType,
      headers: filterAllowedResponseHeaders({
        allowedNames: SLACK_ALLOWED_RESPONSE_HEADERS,
        contentType: response.contentType,
        headers: response.headers,
      }),
      operation: prepared.operation,
      selector: prepared.selector,
      source: {
        displayName: source.displayName,
        provider: source.provider,
        sourceKey: source.sourceKey,
      },
      status: response.status,
    } satisfies SourceApiExecutionResult;
  },
};

function buildSlackExamples(
  sourceKey: string,
  canSendMessages: boolean
): SourceApiExample[] {
  const readExamples: SourceApiExample[] = [
    {
      command: `onequery api --source ${sourceKey} --op list_channels --input '{"limit":100}'`,
      description: "List channels visible to the installed Slack app.",
      label: "List channels",
    },
    {
      command: `onequery api --source ${sourceKey} --op fetch_channel_history "#general" --input '{"limit":50}'`,
      description: "Fetch recent messages from a channel.",
      label: "Fetch channel history",
    },
    {
      command: `onequery api --source ${sourceKey} --op fetch_thread_replies "#general" --input '{"ts":"1730000000.000000"}'`,
      description: "Fetch replies from a Slack thread.",
      label: "Fetch thread replies",
    },
  ];

  if (!canSendMessages) {
    return readExamples;
  }

  return [
    ...readExamples,
    {
      command: `onequery api --source ${sourceKey} --op send_message "#general" --input '{"text":"Deployment finished."}'`,
      description: "Send a message to a channel.",
      label: "Send message",
    },
  ];
}

function requireSlackOperation(input: {
  descriptor: SourceApiDescriptor;
  operationName: string;
}): SourceApiOperation {
  const operation = input.descriptor.operations.find(
    (candidate) => candidate.name === input.operationName
  );
  if (!operation) {
    throw new SourceApiUnsupportedOperationError(input.operationName);
  }
  return operation;
}

function parseSlackOperation(operation: string): SlackOperation {
  const parsed = slackOperationSchema.safeParse(operation);
  if (!parsed.success) {
    throw new SourceApiUnsupportedOperationError(operation);
  }
  return parsed.data;
}

function parseSlackRequest(input: {
  operation: string;
  value: unknown;
}): SlackRequest {
  const schema =
    input.operation === "list_channels"
      ? slackListChannelsRequestSchema
      : input.operation === "fetch_thread_replies"
        ? slackThreadRepliesRequestSchema
        : input.operation === "fetch_channel_history"
          ? slackChannelHistoryRequestSchema
          : input.operation === "send_message"
            ? slackSendMessageRequestSchema
            : null;

  if (!schema) {
    throw new SourceApiUnsupportedOperationError(input.operation);
  }

  const parsed = schema.safeParse(input.value);
  if (!parsed.success) {
    throw new SlackInvalidRequestError(
      `Invalid Slack ${input.operation} request: ${z.prettifyError(parsed.error)}`
    );
  }
  return parsed.data;
}

function parseSlackRequestBody(body: SourceApiRequestBody): JsonObject {
  if (body.kind === "none") {
    return {};
  }
  if (body.kind === "json" && isRecord(body.value)) {
    return body.value;
  }
  throw new SlackInvalidRequestError(
    "Slack source API requests must use a JSON object body or fieldPatch entries"
  );
}

function normalizeSlackSelector(input: {
  operation: string;
  selector?: string;
}): string | undefined {
  const selector = input.selector?.trim();
  if (input.operation === "list_channels") {
    if (selector) {
      throw new SlackInvalidRequestError(
        'Slack operation "list_channels" does not accept a selector'
      );
    }
    return undefined;
  }

  if (!selector) {
    throw new SlackInvalidRequestError(
      `Slack operation "${input.operation}" requires a channel selector`
    );
  }
  return selector;
}

function requireSlackCredentials(
  source: PreparedSourceConnection
): SlackCredentials {
  if (source.credentials.type !== "slack") {
    throw new SlackInvalidRequestError(
      `Slack source API requires Slack credentials, received "${source.credentials.type}"`
    );
  }
  return source.credentials;
}

function canSlackSendMessages(credentials: SlackCredentials): boolean {
  return credentials.botScopes.includes(SLACK_CHAT_WRITE_SCOPE);
}

function assertSlackCanSendMessages(credentials: SlackCredentials): void {
  if (!canSlackSendMessages(credentials)) {
    throw new SlackInvalidRequestError(
      `Slack send_message requires the ${SLACK_CHAT_WRITE_SCOPE} bot scope`
    );
  }
}

async function executeSlackOperation(input: {
  credentials: SlackCredentials;
  operation: SlackOperation;
  request: SlackRequest;
  selector?: string;
}): Promise<SlackApiResponse> {
  switch (input.operation) {
    case "list_channels":
      return callSlackApi({
        credentials: input.credentials,
        method: "conversations.list",
        params: {
          cursor: input.request.cursor,
          exclude_archived: input.request.exclude_archived ?? true,
          limit: input.request.limit ?? 100,
          types: input.request.types ?? "public_channel,private_channel",
        },
      });
    case "fetch_channel_history": {
      const channel = await resolveSlackChannel({
        credentials: input.credentials,
        selector: input.selector,
      });
      return callSlackApi({
        credentials: input.credentials,
        method: "conversations.history",
        params: {
          channel,
          cursor: input.request.cursor,
          inclusive: input.request.inclusive,
          latest: input.request.latest,
          limit: input.request.limit ?? 50,
          oldest: input.request.oldest,
        },
      });
    }
    case "fetch_thread_replies": {
      const ts =
        typeof input.request.ts === "string"
          ? input.request.ts
          : input.request.thread_ts;
      if (!ts) {
        throw new SlackInvalidRequestError(
          'Slack thread replies require request field "ts" or "thread_ts"'
        );
      }
      const channel = await resolveSlackChannel({
        credentials: input.credentials,
        selector: input.selector,
      });
      return callSlackApi({
        credentials: input.credentials,
        method: "conversations.replies",
        params: {
          channel,
          cursor: input.request.cursor,
          inclusive: input.request.inclusive,
          latest: input.request.latest,
          limit: input.request.limit ?? 50,
          oldest: input.request.oldest,
          ts,
        },
      });
    }
    case "send_message": {
      assertSlackCanSendMessages(input.credentials);
      const channel = await resolveSlackChannel({
        credentials: input.credentials,
        selector: input.selector,
      });
      return callSlackApi({
        credentials: input.credentials,
        method: "chat.postMessage",
        params: {
          blocks: input.request.blocks,
          channel,
          text: input.request.text,
          thread_ts: input.request.thread_ts,
        },
      });
    }
  }
}

async function resolveSlackChannel(input: {
  credentials: SlackCredentials;
  selector?: string;
}): Promise<string> {
  const normalized = normalizeChannelSelector(input.selector);
  if (!normalized) {
    throw new SlackInvalidRequestError("Slack channel selector is required");
  }
  if (CHANNEL_ID_PATTERN.test(normalized)) {
    return normalized;
  }

  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const response = await callSlackApi({
      credentials: input.credentials,
      method: "conversations.list",
      params: {
        cursor,
        limit: 200,
        types: "public_channel,private_channel",
      },
    });
    const value = response.body.value;
    const channels = isRecord(value) ? value.channels : undefined;
    if (Array.isArray(channels)) {
      const found = channels.find(
        (channel) =>
          isRecord(channel) &&
          channel.name === normalized &&
          typeof channel.id === "string"
      );
      if (isRecord(found) && typeof found.id === "string") {
        return found.id;
      }
    }

    const metadata = isRecord(value) ? value.response_metadata : undefined;
    cursor =
      isRecord(metadata) && typeof metadata.next_cursor === "string"
        ? metadata.next_cursor
        : undefined;
    if (!cursor) {
      break;
    }
  }

  throw new SlackInvalidRequestError(
    `Slack channel "${normalized}" was not found`
  );
}

function normalizeChannelSelector(selector: string | undefined): string | null {
  const trimmed = selector?.trim() ?? "";
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
}

async function callSlackApi(input: {
  credentials: SlackCredentials;
  method: string;
  params: Record<string, unknown>;
}): Promise<SlackApiResponse> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(input.params)) {
    const stringValue = stringifySlackParam(value);
    if (stringValue !== undefined && stringValue.length > 0) {
      body.set(key, stringValue);
    }
  }

  const response = await fetch(`${SLACK_API_BASE_URL}/${input.method}`, {
    body,
    headers: {
      Authorization: `Bearer ${input.credentials.botToken}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    method: "POST",
  });
  const value = (await response.json().catch(() => null)) as JsonValue;

  if (!response.ok) {
    throw new Error(`Slack API HTTP error ${response.status}`);
  }
  if (isRecord(value) && value.ok === false) {
    const error =
      typeof value.error === "string" ? value.error : "unknown_error";
    throw new Error(`Slack API error: ${error}`);
  }

  return {
    body: { kind: "json", value },
    contentType: "application/json",
    headers: [],
    status: response.status,
  };
}

function stringifySlackParam(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
