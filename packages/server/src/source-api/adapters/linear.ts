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
const LINEAR_IMAGE_UPLOAD_REQUEST_HEADERS = [
  "content-type",
  "x-onequery-alt-text",
  "x-onequery-comment-body",
  "x-onequery-file-name",
  "x-onequery-parent-id",
] as const;
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

const LinearImageCommentRequestSchema = z
  .object({
    altText: z.string().min(1).optional(),
    commentBody: z.string().min(1).optional(),
    contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
    fileName: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          !value.includes("/") &&
          !value.includes("\\") &&
          !value.includes(String.fromCharCode(0))
      ),
    issueId: z.string().min(1),
    parentId: z.string().min(1).optional(),
  })
  .strict();

const LinearFileUploadPayloadSchema = z.object({
  data: z.object({
    fileUpload: z.object({
      success: z.literal(true),
      uploadFile: z.object({
        assetUrl: z.string().url(),
        headers: z.array(
          z.object({ key: z.string().min(1), value: z.string() }).strict()
        ),
        uploadUrl: z.string().url(),
      }),
    }),
  }),
});
type LinearOperationName =
  | "list_teams"
  | "list_workflow_states"
  | "list_issues"
  | "get_issue"
  | "create_issue"
  | "create_comment"
  | "create_comment_with_image"
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

type LinearSourceApiAdapterOptions = {
  fetchImpl?: typeof fetch;
};

export function createLinearSourceApiAdapter(
  options: LinearSourceApiAdapterOptions = {}
): SourceApiAdapter {
  return {
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
      const selector = normalizeLinearSelector({
        operation: operationName,
        selector: request.selector,
      });
      const normalizedRequest =
        operationName === "create_comment_with_image"
          ? normalizeLinearImageCommentRequest({
              body: request.body,
              fieldPatch: request.fieldPatch,
              headers: request.headers,
              methodOverride: request.methodOverride,
              selector,
            })
          : normalizeLinearGraphQlRequest({
              body: request.body,
              fieldPatch: request.fieldPatch,
              headers: request.headers,
              methodOverride: request.methodOverride,
              operation: operationName,
              selector,
            });

      return {
        body: normalizedRequest.body,
        descriptorVersion: descriptor.descriptorVersion,
        headers: [],
        kind: "structured_request",
        method: "POST",
        operation: operation.name,
        paginationPolicy: operation.paginationPolicy,
        provider: source.provider,
        request: normalizedRequest.request,
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
      if (prepared.operation === "create_comment_with_image") {
        return executeLinearImageComment({
          credentials,
          fetchImpl: options.fetchImpl,
          prepared,
          source,
        });
      }

      const requestObject = applyLinearContinuation({
        continuation,
        prepared,
      });
      const response = await requestLinearGraphQl({
        credentials,
        fetchImpl: options.fetchImpl,
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
}

export const linearSourceApiAdapter = createLinearSourceApiAdapter();

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
    createLinearImageUploadOperation({
      examples: examples.filter(
        (example) => example.label === "Create comment with image"
      ),
    }),
  ];
}

function createLinearImageUploadOperation(input: {
  examples: readonly SourceApiExample[];
}): SourceApiOperation {
  return {
    description:
      "Upload a local image through Linear's fileUpload API and create a comment that embeds the resulting private asset. Requires an issue id selector, --input image path, Content-Type, and X-OneQuery-File-Name headers.",
    examples: input.examples,
    fieldPolicy: {
      acceptsInput: true,
      allowsRawFields: false,
      allowsTypedFields: false,
      inputMode: "request_body",
      mergePatches: false,
      supportsArrayPaths: false,
      supportsNestedPaths: false,
    },
    headerPolicy: canonicalizeSourceApiHeaderPolicy({
      allowedRequestHeaders: LINEAR_IMAGE_UPLOAD_REQUEST_HEADERS,
      allowedResponseHeaders: LINEAR_ALLOWED_RESPONSE_HEADERS,
    }),
    kind: "structured_request",
    methodPolicy: {
      allowedMethods: ["POST"],
      defaultMethod: "POST",
    },
    name: "create_comment_with_image",
    notes: [
      "The file is uploaded server-side with Linear's fileUpload mutation and pre-signed PUT flow.",
      "X-OneQuery-Comment-Body, X-OneQuery-Alt-Text, and X-OneQuery-Parent-Id are optional.",
    ],
    paginationPolicy: "none",
    selectorKind: "identifier",
    selectorLabel: "ISSUE_ID_OR_IDENTIFIER",
    summary: "Upload a local image and attach it to a Linear comment.",
  };
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
    {
      command: `onequery api --source ${sourceKey} --op create_comment_with_image <issue-id> --input ./screenshot.png -H 'Content-Type:image/png' -H 'X-OneQuery-File-Name:screenshot.png'`,
      description:
        "Upload a local image to Linear and embed it in a new issue comment.",
      label: "Create comment with image",
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
      "This Linear connection is read-only; create_issue, create_comment, create_comment_with_image, and update_issue are disabled."
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
      input.operation === "create_comment_with_image" ||
      input.operation === "update_issue")
  ) {
    throw new SourceApiInvalidRequestError(
      `Linear connection is read-only; ${input.operation} requires read_write access`
    );
  }
}

function normalizeLinearGraphQlRequest(input: {
  operation: Exclude<LinearOperationName, "create_comment_with_image">;
  selector?: string;
  fieldPatch?: JsonObject;
  methodOverride?: string;
  headers: readonly { name: string; value: string }[];
  body: SourceApiRequestBody;
}): { body: SourceApiRequestBody; request: JsonObject } {
  assertNoLinearRequestExtras(input);
  return {
    body: { kind: "none" },
    request: buildLinearGraphQlRequest({
      fieldPatch: input.fieldPatch,
      operation: input.operation,
      selector: input.selector,
    }),
  };
}

function normalizeLinearImageCommentRequest(input: {
  selector?: string;
  fieldPatch?: JsonObject;
  methodOverride?: string;
  headers: readonly { name: string; value: string }[];
  body: SourceApiRequestBody;
}): { body: SourceApiRequestBody; request: JsonObject } {
  if (input.methodOverride?.trim()) {
    throw new SourceApiInvalidRequestError(
      'Linear operation "create_comment_with_image" does not support method overrides'
    );
  }
  if (input.fieldPatch && Object.keys(input.fieldPatch).length > 0) {
    throw new SourceApiInvalidRequestError(
      'Linear operation "create_comment_with_image" accepts --input, not fieldPatch input'
    );
  }
  if (input.body.kind !== "binary" && input.body.kind !== "text") {
    throw new SourceApiInvalidRequestError(
      'Linear operation "create_comment_with_image" requires a local image through --input'
    );
  }
  if (
    (input.body.kind === "binary" && input.body.value.byteLength === 0) ||
    (input.body.kind === "text" && input.body.value.length === 0)
  ) {
    throw new SourceApiInvalidRequestError(
      'Linear operation "create_comment_with_image" requires a non-empty image'
    );
  }

  const headers = readLinearImageRequestHeaders(input.headers);
  const parsed = LinearImageCommentRequestSchema.safeParse({
    altText: normalizeOptionalHeader(headers.get("x-onequery-alt-text")),
    commentBody: normalizeOptionalHeader(
      headers.get("x-onequery-comment-body")
    ),
    contentType: normalizeRequiredHeader({
      headers,
      name: "content-type",
      operation: "create_comment_with_image",
    }).toLowerCase(),
    fileName: normalizeRequiredHeader({
      headers,
      name: "x-onequery-file-name",
      operation: "create_comment_with_image",
    }),
    issueId: input.selector,
    parentId: normalizeOptionalHeader(headers.get("x-onequery-parent-id")),
  });
  if (!parsed.success) {
    if (
      typeof parsed.error.flatten().fieldErrors.contentType?.[0] === "string"
    ) {
      throw new SourceApiInvalidRequestError(
        'Linear operation "create_comment_with_image" requires an image content type such as image/png'
      );
    }
    throw new SourceApiInvalidRequestError(
      "Invalid Linear create_comment_with_image request metadata"
    );
  }

  return {
    body: input.body,
    request: compactJsonObject(parsed.data),
  };
}

function readLinearImageRequestHeaders(
  input: readonly { name: string; value: string }[]
): Map<string, string> {
  const allowedNames = new Set<string>(LINEAR_IMAGE_UPLOAD_REQUEST_HEADERS);
  const headers = new Map<string, string>();

  for (const header of input) {
    const name = header.name.trim().toLowerCase();
    if (!allowedNames.has(name)) {
      throw new SourceApiInvalidRequestError(
        `Linear operation "create_comment_with_image" does not accept request header "${header.name}"`
      );
    }
    if (headers.has(name)) {
      throw new SourceApiInvalidRequestError(
        `Linear operation "create_comment_with_image" received duplicate request header "${header.name}"`
      );
    }
    headers.set(name, header.value);
  }

  return headers;
}

function normalizeRequiredHeader(input: {
  headers: ReadonlyMap<string, string>;
  name: string;
  operation: string;
}): string {
  const value = normalizeOptionalHeader(input.headers.get(input.name));
  if (value) {
    return value;
  }
  throw new SourceApiInvalidRequestError(
    `Linear operation "${input.operation}" requires request header "${input.name}"`
  );
}

function normalizeOptionalHeader(
  value: string | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
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

  if (
    input.operation !== "get_issue" &&
    input.operation !== "create_comment_with_image"
  ) {
    if (selector) {
      throw new SourceApiInvalidRequestError(
        `Linear operation "${input.operation}" does not accept a selector`
      );
    }
    return undefined;
  }

  if (!selector && input.operation === "get_issue") {
    throw new SourceApiInvalidRequestError(
      'Linear operation "get_issue" requires an issue id or identifier selector'
    );
  }

  if (!selector) {
    throw new SourceApiInvalidRequestError(
      'Linear operation "create_comment_with_image" requires an issue id or identifier selector'
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
    case "create_comment_with_image":
      throw new SourceApiInvalidRequestError(
        'Linear operation "create_comment_with_image" requires binary request input'
      );
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

async function executeLinearImageComment(input: {
  credentials: LinearCredentials;
  fetchImpl?: typeof fetch;
  prepared: PreparedStructuredSourceApi;
  source: PreparedSourceConnection;
}): Promise<SourceApiExecutionResult> {
  const request = LinearImageCommentRequestSchema.safeParse(
    input.prepared.request
  );
  if (!request.success) {
    throw new SourceApiInvalidRequestError(
      "Invalid prepared Linear create_comment_with_image request"
    );
  }

  const fileBytes = readLinearImageBody(input.prepared.body);
  const uploadPayload = await requestLinearGraphQl({
    credentials: input.credentials,
    fetchImpl: input.fetchImpl,
    request: {
      query: `mutation VelenLinearFileUpload($contentType: String!, $filename: String!, $size: Int!) {
  fileUpload(contentType: $contentType, filename: $filename, size: $size) {
    success
    uploadFile {
      uploadUrl
      assetUrl
      headers {
        key
        value
      }
    }
  }
}`,
      variables: {
        contentType: request.data.contentType,
        filename: request.data.fileName,
        size: fileBytes.byteLength,
      },
    },
  });
  const uploadFile = parseLinearFileUploadPayload(uploadPayload.body);
  const uploadUrl = requireLinearHttpsUrl(uploadFile.uploadUrl, "upload URL");
  const assetUrl = requireLinearHttpsUrl(uploadFile.assetUrl, "asset URL");

  const uploadHeaders = new Headers();
  uploadHeaders.set("Content-Type", request.data.contentType);
  uploadHeaders.set("Cache-Control", "public, max-age=31536000");
  for (const header of uploadFile.headers) {
    uploadHeaders.set(header.key, header.value);
  }

  const uploadResponse = await uploadLinearFile({
    body: fileBytes,
    fetchImpl: input.fetchImpl,
    headers: uploadHeaders,
    uploadUrl,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Linear file upload failed (${uploadResponse.status})`);
  }

  const imageMarkdown = `![${escapeLinearMarkdownAltText(
    request.data.altText ?? request.data.fileName
  )}](${assetUrl})`;
  const commentBody = request.data.commentBody
    ? `${request.data.commentBody}\n\n${imageMarkdown}`
    : imageMarkdown;
  const commentRequest = buildLinearGraphQlRequest({
    fieldPatch: compactJsonObject({
      body: commentBody,
      issueId: request.data.issueId,
      parentId: request.data.parentId,
    }),
    operation: "create_comment",
  });
  const commentResponse = await requestLinearGraphQl({
    credentials: input.credentials,
    fetchImpl: input.fetchImpl,
    request: commentRequest,
  });

  return buildLinearExecutionResult({
    operation: input.prepared.operation,
    response: commentResponse,
    selector: input.prepared.selector,
    source: input.source,
  });
}

function readLinearImageBody(
  body: SourceApiRequestBody
): Uint8Array<ArrayBuffer> {
  if (body.kind === "binary") {
    return new Uint8Array(body.value);
  }
  if (body.kind === "text") {
    return new TextEncoder().encode(body.value);
  }
  throw new SourceApiInvalidRequestError(
    "Prepared Linear image upload is missing file bytes"
  );
}

function parseLinearFileUploadPayload(body: SourceApiResponseBody) {
  if (body.kind !== "json") {
    throw new Error("Linear fileUpload returned a non-JSON response");
  }
  const parsed = LinearFileUploadPayloadSchema.safeParse(body.value);
  if (!parsed.success) {
    throw new Error("Linear fileUpload did not return an upload destination");
  }
  return parsed.data.data.fileUpload.uploadFile;
}

function requireLinearHttpsUrl(value: string, label: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(`Linear fileUpload returned an invalid ${label}`);
  }
  return url.toString();
}

async function uploadLinearFile(input: {
  body: Uint8Array<ArrayBuffer>;
  fetchImpl?: typeof fetch;
  headers: Headers;
  uploadUrl: string;
}): Promise<Response> {
  try {
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    return await fetchImpl(input.uploadUrl, {
      body: input.body,
      headers: input.headers,
      method: "PUT",
    });
  } catch (error: unknown) {
    throw new Error("Linear file upload request failed", { cause: error });
  }
}

function escapeLinearMarkdownAltText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
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
