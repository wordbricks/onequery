import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import { getLinearAccessMode, isLinearCredentials } from "@onequery/db/server";
import type { LinearAccessMode, LinearCredentials } from "@onequery/db/server";
import { z } from "zod";

import { ProviderHttpClient } from "../../services/provider-http-client";
import {
  SourceApiInvalidRequestError,
  SourceApiUnsupportedOperationError,
} from "../errors";
import { canonicalizeSourceApiHeaderPolicy } from "../helpers/header-policy";
import { filterAllowedResponseHeaders } from "../helpers/http-rest";
import type {
  PreparedSourceConnection,
  PreparedStructuredSourceApi,
  SourceApiAdapter,
  SourceApiDescriptor,
  SourceApiExample,
  SourceApiExecutionResult,
  SourceApiOperation,
  SourceApiRequestBody,
  SourceApiResponseBody,
  SourceApiContinuationState,
} from "../types";

const LINEAR_API_BASE_URL = "https://api.linear.app";
const LINEAR_DESCRIPTOR_VERSION = "linear.v2";
const LINEAR_PUBLIC_FILE_URL_TTL_SECONDS = 300;
const LINEAR_ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "x-ratelimit-requests-limit",
  "x-ratelimit-requests-remaining",
  "x-ratelimit-requests-reset",
] as const;

const LinearIssueFilterSchema = z.record(z.string(), z.unknown());

const ListIssuesInputSchema = z
  .object({
    after: z.string().min(1).optional(),
    filter: LinearIssueFilterSchema.optional(),
    first: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const ListWorkflowStatesInputSchema = z
  .object({
    teamId: z.string().min(1),
  })
  .strict();

const CreateIssueInputSchema = z
  .object({
    assigneeId: z.string().min(1).optional(),
    description: z.string().optional(),
    labelIds: z.array(z.string().min(1)).optional(),
    priority: z.number().int().min(0).max(4).optional(),
    projectId: z.string().min(1).optional(),
    stateId: z.string().min(1).optional(),
    teamId: z.string().min(1),
    title: z.string().min(1).max(255),
  })
  .strict();

const CreateCommentInputSchema = z
  .object({
    body: z.string().min(1),
    issueId: z.string().min(1),
    parentId: z.string().min(1).optional(),
  })
  .strict();

const UpdateIssueStateInputSchema = z
  .object({
    issueId: z.string().min(1),
    stateId: z.string().min(1),
  })
  .strict();

type LinearOperationName =
  | "list_teams"
  | "list_workflow_states"
  | "list_issues"
  | "get_issue"
  | "create_issue"
  | "create_comment"
  | "update_issue";

type ListIssuesInput = z.infer<typeof ListIssuesInputSchema>;
type ListWorkflowStatesInput = z.infer<typeof ListWorkflowStatesInputSchema>;
type CreateIssueInput = z.infer<typeof CreateIssueInputSchema>;
type CreateCommentInput = z.infer<typeof CreateCommentInputSchema>;
type UpdateIssueStateInput = z.infer<typeof UpdateIssueStateInputSchema>;

type LinearGraphQlResponse = {
  body: SourceApiResponseBody;
  contentType: string;
  headers: { name: string; value: string }[];
  status: number;
};

export const linearSourceApiAdapter: SourceApiAdapter = {
  provider: "linear",
  async describe({ source }) {
    const credentials = requireLinearCredentials(source);
    const accessMode = getLinearAccessMode(credentials);
    const examples = buildLinearExamples(source.sourceKey, accessMode);

    return {
      defaultPathOperation:
        accessMode === "mention" ? undefined : "list_issues",
      descriptorVersion: LINEAR_DESCRIPTOR_VERSION,
      examples,
      notes: buildLinearNotes(accessMode),
      operations: buildLinearOperations(accessMode, examples),
      source: {
        displayName: source.displayName,
        provider: source.provider,
        sourceKey: source.sourceKey,
      },
    };
  },
  async normalize({ descriptor, request, source }) {
    const operation = requireLinearOperation({
      descriptor,
      operationName: request.operation,
    });
    const credentials = requireLinearCredentials(source);
    const operationName = operation.name as LinearOperationName;

    assertLinearOperationAllowed({
      accessMode: getLinearAccessMode(credentials),
      operation: operationName,
    });
    assertNoLinearRequestExtras({
      body: request.body,
      headers: request.headers,
      methodOverride: request.methodOverride,
      operation: operationName,
    });

    const selector = normalizeLinearSelector({
      operation: operationName,
      selector: request.selector,
    });
    const requestObject = buildLinearGraphQlRequest({
      fieldPatch: request.fieldPatch,
      operation: operationName,
      selector,
    });

    return {
      body: { kind: "none" },
      descriptorVersion: descriptor.descriptorVersion,
      headers: [],
      kind: "structured_request",
      method: "POST",
      operation: operation.name,
      paginationPolicy: operation.paginationPolicy,
      provider: source.provider,
      request: requestObject,
      selector,
      sourceId: source.id,
      sourceKey: source.sourceKey,
    };
  },
  async execute({ continuation, prepared, source }) {
    if (prepared.kind !== "structured_request") {
      throw new Error(
        `Linear source API operation "${prepared.operation}" requires a structured plan`
      );
    }

    const credentials = requireLinearCredentials(source);
    const requestObject = applyLinearContinuation({
      continuation,
      prepared,
    });
    const response = await requestLinearGraphQl({
      credentials,
      request: requestObject,
    });

    return buildLinearExecutionResult({
      operation: prepared.operation,
      response,
      selector: prepared.selector,
      source,
    });
  },
};

function buildLinearOperations(
  accessMode: LinearAccessMode,
  examples: readonly SourceApiExample[]
): SourceApiOperation[] {
  if (accessMode === "mention") {
    return [];
  }

  const readOperations = [
    createLinearReadOperation({
      description: "List teams visible to the connected Linear app.",
      examples: examples.filter((example) => example.label === "List teams"),
      name: "list_teams",
      selectorKind: "none",
      summary: "List Linear teams.",
    }),
    createLinearInputOperation({
      description: "List workflow states for a Linear team. Requires `teamId`.",
      examples: examples.filter(
        (example) => example.label === "List workflow states"
      ),
      name: "list_workflow_states",
      summary: "List workflow states for a Linear team.",
    }),
    createLinearInputOperation({
      description:
        "List Linear issues with optional Linear issue filter input. Use `first` to limit results and `filter` for Linear GraphQL issue filters.",
      examples: examples.filter((example) => example.label === "List issues"),
      name: "list_issues",
      paginationPolicy: "continuation_token",
      summary: "List Linear issues.",
    }),
    createLinearReadOperation({
      description:
        "Fetch one Linear issue by id or issue identifier, for example `ENG-123`.",
      examples: examples.filter((example) => example.label === "Get issue"),
      name: "get_issue",
      selectorKind: "identifier",
      selectorLabel: "ISSUE_ID_OR_IDENTIFIER",
      summary: "Get one Linear issue.",
    }),
  ];

  if (accessMode !== "read_write") {
    return readOperations;
  }

  return [
    ...readOperations,
    createLinearInputOperation({
      description:
        "Create a Linear issue. Requires `teamId` and `title`; optional fields include `description`, `priority`, `assigneeId`, `stateId`, `projectId`, and `labelIds`.",
      examples: examples.filter((example) => example.label === "Create issue"),
      name: "create_issue",
      summary: "Create a Linear issue.",
    }),
    createLinearInputOperation({
      description:
        "Create a Linear comment on an issue. Requires `issueId` and `body`; optional fields include `parentId` for replies.",
      examples: examples.filter(
        (example) => example.label === "Create comment"
      ),
      name: "create_comment",
      summary: "Create a Linear issue comment.",
    }),
    createLinearInputOperation({
      description:
        "Update a Linear issue's workflow state. Requires `issueId` and `stateId`.",
      examples: examples.filter(
        (example) => example.label === "Update issue state"
      ),
      name: "update_issue",
      summary: "Update a Linear issue's workflow state.",
    }),
  ];
}

function createLinearReadOperation(input: {
  name: LinearOperationName;
  summary: string;
  description: string;
  selectorKind: SourceApiOperation["selectorKind"];
  selectorLabel?: string;
  examples: readonly SourceApiExample[];
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
      allowedResponseHeaders: LINEAR_ALLOWED_RESPONSE_HEADERS,
    }),
    kind: "structured_request",
    methodPolicy: {
      allowedMethods: ["POST"],
      defaultMethod: "POST",
    },
    name: input.name,
    notes: [],
    paginationPolicy: "none",
    selectorKind: input.selectorKind,
    selectorLabel: input.selectorLabel,
    summary: input.summary,
  };
}

function createLinearInputOperation(input: {
  name: LinearOperationName;
  summary: string;
  description: string;
  examples: readonly SourceApiExample[];
  paginationPolicy?: SourceApiOperation["paginationPolicy"];
}): SourceApiOperation {
  return {
    description: input.description,
    examples: input.examples,
    fieldPolicy: {
      acceptsInput: true,
      allowsRawFields: true,
      allowsTypedFields: true,
      inputMode: "request_object",
      mergePatches: false,
      supportsArrayPaths: true,
      supportsNestedPaths: true,
    },
    headerPolicy: canonicalizeSourceApiHeaderPolicy({
      allowedRequestHeaders: [],
      allowedResponseHeaders: LINEAR_ALLOWED_RESPONSE_HEADERS,
    }),
    kind: "structured_request",
    methodPolicy: {
      allowedMethods: ["POST"],
      defaultMethod: "POST",
    },
    name: input.name,
    notes: [],
    paginationPolicy: input.paginationPolicy ?? "none",
    selectorKind: "none",
    summary: input.summary,
  };
}

function buildLinearExamples(
  sourceKey: string,
  accessMode: LinearAccessMode
): SourceApiExample[] {
  if (accessMode === "mention") {
    return [];
  }

  const readExamples: SourceApiExample[] = [
    {
      command: `onequery api --source ${sourceKey} --op list_teams`,
      description: "List Linear teams available to the connected app.",
      label: "List teams",
    },
    {
      command: `onequery api --source ${sourceKey} --op list_workflow_states -f 'teamId=<team-id>'`,
      description: "List workflow states available for a Linear team.",
      label: "List workflow states",
    },
    {
      command: `onequery api --source ${sourceKey} --op list_issues -f 'first=20'`,
      description: "List recently updated Linear issues.",
      label: "List issues",
    },
    {
      command: `onequery api --source ${sourceKey} --op get_issue ENG-123`,
      description: "Fetch one Linear issue by identifier.",
      label: "Get issue",
    },
  ];

  if (accessMode !== "read_write") {
    return readExamples;
  }

  return [
    ...readExamples,
    {
      command: `onequery api --source ${sourceKey} --op create_issue -f 'teamId=<team-id>' -f 'title=Investigate onboarding drop-off'`,
      description: "Create a Linear issue in a team.",
      label: "Create issue",
    },
    {
      command: `onequery api --source ${sourceKey} --op create_comment -f 'issueId=<issue-id>' -f 'body=Investigation started'`,
      description: "Create a comment on a Linear issue.",
      label: "Create comment",
    },
    {
      command: `onequery api --source ${sourceKey} --op update_issue -f 'issueId=<issue-id>' -f 'stateId=<state-id>'`,
      description: "Change a Linear issue's workflow state.",
      label: "Update issue state",
    },
  ];
}

function buildLinearNotes(accessMode: LinearAccessMode): string[] {
  if (accessMode === "mention") {
    return [
      "This Linear connection is configured for @mentions only. Linear Source API operations are disabled.",
    ];
  }

  const notes = [
    "Linear Source API uses fixed GraphQL operations instead of accepting raw GraphQL from the caller.",
    "Use list_teams first when you need a teamId for issue creation.",
    "Use list_workflow_states with an issue's teamId before changing the issue state.",
  ];

  if (accessMode === "read") {
    notes.push(
      "This Linear connection is read-only; create_issue, create_comment, and update_issue are disabled."
    );
  }

  return notes;
}

function requireLinearOperation(input: {
  descriptor: SourceApiDescriptor;
  operationName: string;
}): SourceApiOperation {
  const operation = input.descriptor.operations.find(
    (candidate) => candidate.name === input.operationName.trim()
  );
  if (operation) {
    return operation;
  }

  throw new SourceApiUnsupportedOperationError(input.operationName);
}

function requireLinearCredentials(
  source: PreparedSourceConnection
): LinearCredentials {
  if (isLinearCredentials(source.credentials)) {
    return source.credentials;
  }

  throw new Error("Linear source credentials are invalid");
}

function assertLinearOperationAllowed(input: {
  accessMode: LinearAccessMode;
  operation: LinearOperationName;
}) {
  if (input.accessMode === "mention") {
    throw new SourceApiUnsupportedOperationError(input.operation);
  }
  if (
    input.accessMode === "read" &&
    (input.operation === "create_issue" ||
      input.operation === "create_comment" ||
      input.operation === "update_issue")
  ) {
    throw new SourceApiInvalidRequestError(
      `Linear connection is read-only; ${input.operation} requires read_write access`
    );
  }
}

function assertNoLinearRequestExtras(input: {
  operation: LinearOperationName;
  methodOverride?: string;
  headers: readonly { name: string; value: string }[];
  body: SourceApiRequestBody;
}) {
  if (input.methodOverride?.trim()) {
    throw new SourceApiInvalidRequestError(
      `Linear operation "${input.operation}" does not support method overrides`
    );
  }
  if (input.headers.length > 0) {
    throw new SourceApiInvalidRequestError(
      `Linear operation "${input.operation}" does not accept request headers`
    );
  }
  if (input.body.kind !== "none") {
    throw new SourceApiInvalidRequestError(
      `Linear operation "${input.operation}" accepts fieldPatch input, not request bodies`
    );
  }
}

function normalizeLinearSelector(input: {
  operation: LinearOperationName;
  selector?: string;
}): string | undefined {
  const selector = input.selector?.trim();

  if (input.operation !== "get_issue") {
    if (selector) {
      throw new SourceApiInvalidRequestError(
        `Linear operation "${input.operation}" does not accept a selector`
      );
    }
    return undefined;
  }

  if (!selector) {
    throw new SourceApiInvalidRequestError(
      'Linear operation "get_issue" requires an issue id or identifier selector'
    );
  }

  return selector;
}

function buildLinearGraphQlRequest(input: {
  operation: LinearOperationName;
  selector?: string;
  fieldPatch?: JsonObject;
}): JsonObject {
  switch (input.operation) {
    case "list_teams":
      assertNoFieldPatch(input.fieldPatch, input.operation);
      return {
        query: `query VelenLinearTeams {
  teams(first: 100) {
    nodes {
      id
      key
      name
    }
  }
}`,
        variables: {},
      };
    case "list_workflow_states": {
      const variables = parseListWorkflowStatesInput(input.fieldPatch);
      return {
        query: `query VelenLinearWorkflowStates($id: String!) {
  team(id: $id) {
    id
    key
    name
    states(first: 100) {
      nodes {
        id
        name
        type
        color
        position
      }
    }
  }
}`,
        variables: {
          id: variables.teamId,
        },
      };
    }
    case "list_issues": {
      const variables = parseListIssuesInput(input.fieldPatch);
      return {
        query: `query VelenLinearIssues($first: Int!, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      description
      priority
      url
      createdAt
      updatedAt
      team {
        id
        key
        name
      }
      state {
        id
        name
        type
      }
      assignee {
        id
        name
        email
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`,
        variables,
      };
    }
    case "get_issue":
      assertNoFieldPatch(input.fieldPatch, input.operation);
      return {
        query: `query VelenLinearIssue($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    priority
    url
    createdAt
    updatedAt
    team {
      id
      key
      name
    }
    state {
      id
      name
      type
    }
    assignee {
      id
      name
      email
    }
    comments(first: 25) {
      nodes {
        id
        body
        createdAt
        user {
          id
          name
          email
        }
      }
    }
  }
}`,
        variables: {
          id: input.selector ?? "",
        },
      };
    case "create_issue": {
      const variables = parseCreateIssueInput(input.fieldPatch);
      return {
        query: `mutation VelenLinearIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      title
      url
      createdAt
    }
  }
}`,
        variables: {
          input: variables,
        },
      };
    }
    case "create_comment": {
      const variables = parseCreateCommentInput(input.fieldPatch);
      return {
        query: `mutation VelenLinearCommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment {
      id
      body
      createdAt
      url
      user {
        id
        name
        email
      }
    }
  }
}`,
        variables: {
          input: variables,
        },
      };
    }
    case "update_issue": {
      const variables = parseUpdateIssueInput(input.fieldPatch);
      return {
        query: `mutation VelenLinearIssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue {
      id
      identifier
      title
      url
      updatedAt
      state {
        id
        name
        type
      }
    }
  }
}`,
        variables: {
          id: variables.issueId,
          input: {
            stateId: variables.stateId,
          },
        },
      };
    }
  }
}

function assertNoFieldPatch(
  fieldPatch: JsonObject | undefined,
  operation: LinearOperationName
) {
  if (fieldPatch && Object.keys(fieldPatch).length > 0) {
    throw new SourceApiInvalidRequestError(
      `Linear operation "${operation}" does not accept fieldPatch input`
    );
  }
}

function parseListIssuesInput(fieldPatch: JsonObject | undefined): JsonObject {
  const parsed = ListIssuesInputSchema.safeParse(fieldPatch ?? {});
  if (!parsed.success) {
    throw new SourceApiInvalidRequestError(
      "Invalid Linear list_issues fieldPatch input"
    );
  }

  return compactJsonObject({
    after: parsed.data.after,
    filter: parsed.data.filter,
    first: parsed.data.first ?? 50,
  } satisfies ListIssuesInput);
}

function parseListWorkflowStatesInput(
  fieldPatch: JsonObject | undefined
): ListWorkflowStatesInput {
  const parsed = ListWorkflowStatesInputSchema.safeParse(fieldPatch ?? {});
  if (!parsed.success) {
    throw new SourceApiInvalidRequestError(
      "Invalid Linear list_workflow_states fieldPatch input"
    );
  }

  return parsed.data;
}

function parseCreateIssueInput(fieldPatch: JsonObject | undefined): JsonObject {
  const parsed = CreateIssueInputSchema.safeParse(fieldPatch ?? {});
  if (!parsed.success) {
    throw new SourceApiInvalidRequestError(
      "Invalid Linear create_issue fieldPatch input"
    );
  }

  return compactJsonObject(parsed.data satisfies CreateIssueInput);
}

function parseCreateCommentInput(
  fieldPatch: JsonObject | undefined
): JsonObject {
  const parsed = CreateCommentInputSchema.safeParse(fieldPatch ?? {});
  if (!parsed.success) {
    throw new SourceApiInvalidRequestError(
      "Invalid Linear create_comment fieldPatch input"
    );
  }

  return compactJsonObject(parsed.data satisfies CreateCommentInput);
}

function parseUpdateIssueInput(
  fieldPatch: JsonObject | undefined
): UpdateIssueStateInput {
  const parsed = UpdateIssueStateInputSchema.safeParse(fieldPatch ?? {});
  if (!parsed.success) {
    throw new SourceApiInvalidRequestError(
      "Invalid Linear update_issue fieldPatch input"
    );
  }

  return parsed.data;
}

function compactJsonObject(input: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as JsonObject;
}

function applyLinearContinuation(input: {
  prepared: PreparedStructuredSourceApi;
  continuation?: SourceApiContinuationState;
}): JsonObject {
  if (input.prepared.operation !== "list_issues" || !input.continuation) {
    return input.prepared.request;
  }

  const parsed = z
    .object({ after: z.string().min(1) })
    .safeParse(input.continuation);
  if (!parsed.success) {
    throw new SourceApiInvalidRequestError(
      "Invalid Linear list_issues continuation state"
    );
  }

  const variables = readVariables(input.prepared.request);
  return {
    ...input.prepared.request,
    variables: {
      ...variables,
      after: parsed.data.after,
    },
  };
}

function readVariables(request: JsonObject): JsonObject {
  const variables = request.variables;
  if (variables && typeof variables === "object" && !Array.isArray(variables)) {
    return variables as JsonObject;
  }
  return {};
}

export async function requestLinearGraphQl(input: {
  credentials: LinearCredentials;
  fetchImpl?: typeof fetch;
  request: JsonObject;
}): Promise<LinearGraphQlResponse> {
  const client = new ProviderHttpClient({
    auth: {
      token: getLinearToken(input.credentials),
      type: "bearer",
    },
    baseUrl: LINEAR_API_BASE_URL,
    defaultHeaders: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "public-file-urls-expire-in": String(LINEAR_PUBLIC_FILE_URL_TTL_SECONDS),
    },
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    providerName: "Linear",
  });
  const response = await client.send({
    body: input.request,
    endpoint: "/graphql",
    method: "POST",
  });
  const transportResponse = await responseToLinearTransportResponse(response);

  return {
    body: transportResponse.body,
    contentType: transportResponse.contentType,
    headers: transportResponse.headers,
    status: transportResponse.status,
  };
}

async function responseToLinearTransportResponse(
  response: Response
): Promise<LinearGraphQlResponse> {
  const contentType =
    response.headers.get("content-type") ?? "application/json";
  const raw = await response.text().catch(() => "");
  const value = parseLinearResponseBody(raw);

  return {
    body: { kind: "json", value },
    contentType,
    headers: Array.from(response.headers.entries()).map(([name, value]) => ({
      name,
      value,
    })),
    status: response.status,
  };
}

function parseLinearResponseBody(raw: string): JsonValue {
  if (raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return { text: raw };
  }
}

function buildLinearExecutionResult(input: {
  operation: string;
  selector?: string;
  source: PreparedSourceConnection;
  response: LinearGraphQlResponse;
}): SourceApiExecutionResult {
  return {
    body: input.response.body,
    contentType: input.response.contentType,
    headers: filterAllowedResponseHeaders({
      allowedNames: LINEAR_ALLOWED_RESPONSE_HEADERS,
      contentType: input.response.contentType,
      headers: input.response.headers,
    }),
    nextContinuationState: readNextLinearContinuationState(input.response.body),
    operation: input.operation,
    selector: input.selector,
    source: {
      displayName: input.source.displayName,
      provider: input.source.provider,
      sourceKey: input.source.sourceKey,
    },
    status: input.response.status,
  };
}

function readNextLinearContinuationState(
  body: SourceApiResponseBody
): SourceApiContinuationState | undefined {
  if (body.kind !== "json") {
    return undefined;
  }
  const value = body.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const data = value.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const issues = data.issues;
  if (!issues || typeof issues !== "object" || Array.isArray(issues)) {
    return undefined;
  }
  const pageInfo = issues.pageInfo;
  if (
    !pageInfo ||
    typeof pageInfo !== "object" ||
    Array.isArray(pageInfo) ||
    pageInfo.hasNextPage !== true ||
    typeof pageInfo.endCursor !== "string"
  ) {
    return undefined;
  }

  return { after: pageInfo.endCursor };
}

function getLinearToken(credentials: LinearCredentials): string {
  if ("accessToken" in credentials) {
    return credentials.accessToken;
  }
  return credentials.apiKey;
}
