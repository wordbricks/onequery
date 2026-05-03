import { create, fromJson, toBinary } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { durationFromMs, ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  auditActionDetailSchema,
  auditListResponseSchema,
} from "@onequery/audit-contracts/audit";
import {
  auditFeedEntries,
  auditProjectionCheckpoints,
  createDb,
  queryActions,
  sourceApiActions,
  workflowJournal,
} from "@onequery/db/server";
import {
  WorkflowDataSourceStatus,
  WorkflowSourceProvider,
} from "@onequery/proto-workflow/workflow/v1/common_pb";
import {
  QueryActionCommandPayloadSchema,
  QueryActionCredentialsLoadedEventSchema,
  QueryActionEventPayloadSchema,
  QueryActionMode,
  QueryActionQueryExecutedEventSchema,
  QueryActionQuerySourceRecordSchema,
  QueryActionQueryValidatedEventSchema,
  QueryActionRecordQueryExecutionResultSchema,
  QueryActionReceivedEventSchema,
  QueryActionRecordCredentialsLoadedCommandSchema,
  QueryActionRecordQueryExecutionSucceededCommandSchema,
  QueryActionRecordQueryValidationAcceptedCommandSchema,
  QueryActionRecordQueryValidationPreparationFailedCommandSchema,
  QueryActionRecordSourceFoundCommandSchema,
  QueryActionRecordUsagePersistenceSucceededCommandSchema,
  QueryActionSourceDescriptorSchema,
  QueryActionSourceLoadedEventSchema,
  QueryActionUsagePersistedEventSchema,
  QueryActionQueryPreparationFailedEventSchema,
  QueryActionStartExecuteCommandSchema,
  QueryActionStartValidateCommandSchema,
} from "@onequery/proto-workflow/workflow/v1/query_action_pb";
import {
  SourceApiActionCommandPayloadSchema,
  SourceApiActionDescriptorSchema,
  SourceApiActionDescriptorSourceSchema,
  SourceApiActionDescriptorResolvedEventSchema,
  SourceApiActionEventPayloadSchema,
  SourceApiActionExecutionResultSchema,
  SourceApiActionExecutionSourceSchema,
  SourceApiActionInvokeMode,
  SourceApiActionOperationKind,
  SourceApiActionPageFetchSucceededEventSchema,
  SourceApiActionPaginationPolicy,
  SourceApiActionReceivedEventSchema,
  SourceApiActionRecordDescriptorResolvedCommandSchema,
  SourceApiActionRecordPageFetchSucceededCommandSchema,
  SourceApiActionRecordRequestPreparedCommandSchema,
  SourceApiActionRecordSourceFoundCommandSchema,
  SourceApiActionRequestDescriptorSchema,
  SourceApiActionRequestKind,
  SourceApiActionRequestPreparedEventSchema,
  SourceApiActionSourceDescriptorSchema,
  SourceApiActionSourceLoadedEventSchema,
  SourceApiActionStartInvokeCommandSchema,
} from "@onequery/proto-workflow/workflow/v1/source_api_action_pb";
import { describe, expect, it } from "vitest";

import {
  closeDatabase,
  createPgliteDatabaseUrl,
  createRouteIntegrationHarness,
  createRunId,
} from "../test/integration-helpers";
import type { ClosableDatabase } from "../test/integration-helpers";

type TestDatabase = ReturnType<typeof createDb>;

type WorkflowActorSnapshot = {
  authMode: string | null;
  email: string | null;
  membershipRoles: string[];
  userId: string | null;
};

const journalStreamPositions = new Map<string, number>();

function nextJournalStreamPosition(actionId: string) {
  const next = (journalStreamPositions.get(actionId) ?? 0) + 1;
  journalStreamPositions.set(actionId, next);
  return next;
}

const sourceDescriptor = {
  displayName: "Warehouse",
  name: "warehouse",
  organizationId: "org-placeholder",
  provider: "postgres",
  sourceId: "source-warehouse",
  sourceKey: "warehouse",
  sourceStatus: "active",
} as const;

const sourceApiDescriptor = {
  displayName: "Billing API",
  provider: "github",
  sourceId: "source-billing-api",
  sourceKey: "billing-api",
} as const;

const requestDescriptor = {
  descriptorVersion: "2026-04-20",
  kind: "http_request",
  method: "GET",
  operation: "list_customers",
  paginationPolicy: "continuation_token",
  selector: "/customers",
} as const;

function toWorkflowProvider(provider: string): WorkflowSourceProvider {
  switch (provider) {
    case "postgres":
      return WorkflowSourceProvider.POSTGRES;
    case "github":
      return WorkflowSourceProvider.GITHUB;
    default:
      throw new Error(`unsupported test provider: ${provider}`);
  }
}

function toWorkflowStatus(status: string): WorkflowDataSourceStatus {
  switch (status) {
    case "active":
      return WorkflowDataSourceStatus.ACTIVE;
    default:
      throw new Error(`unsupported test source status: ${status}`);
  }
}

function toQuerySourceDescriptorMessage(source: Record<string, unknown>) {
  return create(QueryActionSourceDescriptorSchema, {
    displayName: source.displayName as string,
    name: source.name as string,
    organizationId: source.organizationId as string,
    provider: toWorkflowProvider(source.provider as string),
    sourceId: source.sourceId as string,
    sourceKey: source.sourceKey as string,
    sourceStatus: toWorkflowStatus(source.sourceStatus as string),
  });
}

function toSourceApiSourceDescriptorMessage(source: Record<string, unknown>) {
  return create(SourceApiActionSourceDescriptorSchema, {
    displayName: source.displayName as string,
    provider: toWorkflowProvider(source.provider as string),
    sourceId: source.sourceId as string,
    sourceKey: source.sourceKey as string,
  });
}

function toSourceApiRequestDescriptorMessage(
  descriptor: Record<string, unknown>
) {
  return create(SourceApiActionRequestDescriptorSchema, {
    descriptorVersion: descriptor.descriptorVersion as string,
    kind: SourceApiActionOperationKind.HTTP_REQUEST,
    method: descriptor.method as string,
    operation: descriptor.operation as string,
    paginationPolicy: SourceApiActionPaginationPolicy.CONTINUATION_TOKEN,
    selector: descriptor.selector as string,
  });
}

function encodeQueryActionCommandPayload(
  commandType: string,
  payload: Record<string, unknown>
) {
  switch (commandType) {
    case "start_execute":
      return Buffer.from(
        toBinary(
          QueryActionCommandPayloadSchema,
          create(QueryActionCommandPayloadSchema, {
            command: {
              case: "startExecute",
              value: create(QueryActionStartExecuteCommandSchema, {
                queryText: payload.queryText as string,
                sourceKey: payload.sourceKey as string,
              }),
            },
          })
        )
      );
    case "start_validate":
      return Buffer.from(
        toBinary(
          QueryActionCommandPayloadSchema,
          create(QueryActionCommandPayloadSchema, {
            command: {
              case: "startValidate",
              value: create(QueryActionStartValidateCommandSchema, {
                queryText: payload.queryText as string,
                sourceKey: payload.sourceKey as string,
              }),
            },
          })
        )
      );
    case "record_source_lookup":
      return Buffer.from(
        toBinary(
          QueryActionCommandPayloadSchema,
          create(QueryActionCommandPayloadSchema, {
            command: {
              case: "recordSourceFound",
              value: create(QueryActionRecordSourceFoundCommandSchema, {
                source: toQuerySourceDescriptorMessage(
                  payload.source as Record<string, unknown>
                ),
              }),
            },
          })
        )
      );
    case "record_query_validation":
      return Buffer.from(
        toBinary(
          QueryActionCommandPayloadSchema,
          create(QueryActionCommandPayloadSchema, {
            command:
              payload.kind === "preparation_failed"
                ? {
                    case: "recordQueryValidationPreparationFailed",
                    value: create(
                      QueryActionRecordQueryValidationPreparationFailedCommandSchema,
                      {
                        detail: payload.detail as string,
                        hint: payload.hint as string,
                      }
                    ),
                  }
                : {
                    case: "recordQueryValidationAccepted",
                    value: create(
                      QueryActionRecordQueryValidationAcceptedCommandSchema,
                      {
                        truncated: false,
                        validatedQuery: payload.validatedQuery as string,
                      }
                    ),
                  },
          })
        )
      );
    case "record_credentials_load":
      return Buffer.from(
        toBinary(
          QueryActionCommandPayloadSchema,
          create(QueryActionCommandPayloadSchema, {
            command: {
              case: "recordCredentialsLoaded",
              value: create(QueryActionRecordCredentialsLoadedCommandSchema),
            },
          })
        )
      );
    case "record_query_execution": {
      const response = payload.response as Record<string, unknown>;
      const source = response.source as Record<string, unknown>;
      return Buffer.from(
        toBinary(
          QueryActionCommandPayloadSchema,
          create(QueryActionCommandPayloadSchema, {
            command: {
              case: "recordQueryExecutionSucceeded",
              value: create(
                QueryActionRecordQueryExecutionSucceededCommandSchema,
                {
                  response: create(
                    QueryActionRecordQueryExecutionResultSchema,
                    {
                      elapsed: durationFromMs(response.elapsedMs as number),
                      rowCount: response.rowCount as number,
                      source: create(QueryActionQuerySourceRecordSchema, {
                        displayName: source.displayName as string,
                        provider: toWorkflowProvider(source.provider as string),
                        sourceId: source.id as string,
                        sourceKey: source.sourceKey as string,
                        sourceStatus: toWorkflowStatus(source.status as string),
                      }),
                      truncated: response.truncated as boolean,
                    }
                  ),
                }
              ),
            },
          })
        )
      );
    }
    case "record_usage_persistence":
      return Buffer.from(
        toBinary(
          QueryActionCommandPayloadSchema,
          create(QueryActionCommandPayloadSchema, {
            command: {
              case: "recordUsagePersistenceSucceeded",
              value: create(
                QueryActionRecordUsagePersistenceSucceededCommandSchema
              ),
            },
          })
        )
      );
    default:
      throw new Error(
        `unsupported query action command fixture: ${commandType}`
      );
  }
}

function encodeQueryActionEventPayload(
  eventType: string,
  payload: Record<string, unknown>
) {
  switch (eventType) {
    case "action_received":
      return Buffer.from(
        toBinary(
          QueryActionEventPayloadSchema,
          create(QueryActionEventPayloadSchema, {
            event: {
              case: "actionReceived",
              value: create(QueryActionReceivedEventSchema, {
                queryMode:
                  payload.queryMode === "execute"
                    ? QueryActionMode.EXECUTE
                    : QueryActionMode.VALIDATE,
                queryText: payload.queryText as string,
              }),
            },
          })
        )
      );
    case "source_loaded":
      return Buffer.from(
        toBinary(
          QueryActionEventPayloadSchema,
          create(QueryActionEventPayloadSchema, {
            event: {
              case: "sourceLoaded",
              value: create(QueryActionSourceLoadedEventSchema, {
                source: toQuerySourceDescriptorMessage(
                  payload.source as Record<string, unknown>
                ),
              }),
            },
          })
        )
      );
    case "query_validated":
      return Buffer.from(
        toBinary(
          QueryActionEventPayloadSchema,
          create(QueryActionEventPayloadSchema, {
            event: {
              case: "queryValidated",
              value: create(QueryActionQueryValidatedEventSchema, {
                validatedQuery: payload.validatedQuery as string,
              }),
            },
          })
        )
      );
    case "credentials_loaded":
      return Buffer.from(
        toBinary(
          QueryActionEventPayloadSchema,
          create(QueryActionEventPayloadSchema, {
            event: {
              case: "credentialsLoaded",
              value: create(QueryActionCredentialsLoadedEventSchema),
            },
          })
        )
      );
    case "query_executed":
      return Buffer.from(
        toBinary(
          QueryActionEventPayloadSchema,
          create(QueryActionEventPayloadSchema, {
            event: {
              case: "queryExecuted",
              value: create(QueryActionQueryExecutedEventSchema, {
                elapsed: durationFromMs(payload.elapsedMs as number),
                rowCount: payload.rowCount as number,
              }),
            },
          })
        )
      );
    case "usage_persisted":
      return Buffer.from(
        toBinary(
          QueryActionEventPayloadSchema,
          create(QueryActionEventPayloadSchema, {
            event: {
              case: "usagePersisted",
              value: create(QueryActionUsagePersistedEventSchema),
            },
          })
        )
      );
    case "query_preparation_failed":
      return Buffer.from(
        toBinary(
          QueryActionEventPayloadSchema,
          create(QueryActionEventPayloadSchema, {
            event: {
              case: "queryPreparationFailed",
              value: create(QueryActionQueryPreparationFailedEventSchema, {
                detail: payload.detail as string,
                hint: payload.hint as string,
              }),
            },
          })
        )
      );
    default:
      throw new Error(`unsupported query action event fixture: ${eventType}`);
  }
}

function encodeSourceApiActionCommandPayload(
  commandType: string,
  payload: Record<string, unknown>
) {
  switch (commandType) {
    case "start_invoke":
      return Buffer.from(
        toBinary(
          SourceApiActionCommandPayloadSchema,
          create(SourceApiActionCommandPayloadSchema, {
            command: {
              case: "startInvoke",
              value: create(SourceApiActionStartInvokeCommandSchema, {
                invokeMode: SourceApiActionInvokeMode.EXECUTE,
                requestDescriptor: toSourceApiRequestDescriptorMessage(
                  payload.requestDescriptor as Record<string, unknown>
                ),
                sourceKey: payload.sourceKey as string,
              }),
            },
          })
        )
      );
    case "record_source_lookup":
      return Buffer.from(
        toBinary(
          SourceApiActionCommandPayloadSchema,
          create(SourceApiActionCommandPayloadSchema, {
            command: {
              case: "recordSourceFound",
              value: create(SourceApiActionRecordSourceFoundCommandSchema, {
                source: toSourceApiSourceDescriptorMessage(
                  payload.source as Record<string, unknown>
                ),
              }),
            },
          })
        )
      );
    case "record_descriptor_resolution":
      return Buffer.from(
        toBinary(
          SourceApiActionCommandPayloadSchema,
          create(SourceApiActionCommandPayloadSchema, {
            command: {
              case: "recordDescriptorResolved",
              value: create(
                SourceApiActionRecordDescriptorResolvedCommandSchema,
                {
                  descriptor: create(SourceApiActionDescriptorSchema, {
                    descriptorVersion: "2026-04-20",
                    source: create(SourceApiActionDescriptorSourceSchema, {
                      displayName: sourceApiDescriptor.displayName,
                      provider: toWorkflowProvider(
                        sourceApiDescriptor.provider
                      ),
                      sourceKey: sourceApiDescriptor.sourceKey,
                    }),
                  }),
                  requestDescriptor: toSourceApiRequestDescriptorMessage(
                    payload.requestDescriptor as Record<string, unknown>
                  ),
                }
              ),
            },
          })
        )
      );
    case "record_request_preparation":
      return Buffer.from(
        toBinary(
          SourceApiActionCommandPayloadSchema,
          create(SourceApiActionCommandPayloadSchema, {
            command: {
              case: "recordRequestPrepared",
              value: create(SourceApiActionRecordRequestPreparedCommandSchema, {
                preparedRequestFingerprint:
                  payload.preparedRequestFingerprint as string,
              }),
            },
          })
        )
      );
    case "record_page_fetch": {
      const result = payload.executionResult as Record<string, unknown>;
      const body = result.body as Record<string, unknown>;
      const source = result.source as Record<string, unknown>;
      return Buffer.from(
        toBinary(
          SourceApiActionCommandPayloadSchema,
          create(SourceApiActionCommandPayloadSchema, {
            command: {
              case: "recordPageFetchSucceeded",
              value: create(
                SourceApiActionRecordPageFetchSucceededCommandSchema,
                {
                  attemptNumber: payload.attemptNumber as number,
                  contentType: payload.contentType as string,
                  executionResult: create(
                    SourceApiActionExecutionResultSchema,
                    {
                      body: {
                        case: "json",
                        value: fromJson(ValueSchema, body.value as JsonValue),
                      },
                      contentType: result.contentType as string,
                      httpStatus: result.status as number,
                      nextContinuationState: fromJson(
                        ValueSchema,
                        result.nextContinuationState as JsonValue
                      ),
                      operation: result.operation as string,
                      selector: result.selector as string,
                      source: create(SourceApiActionExecutionSourceSchema, {
                        displayName: source.displayName as string,
                        provider: toWorkflowProvider(source.provider as string),
                        sourceKey: source.sourceKey as string,
                      }),
                    }
                  ),
                  hasContinuation: payload.hasContinuation as boolean,
                  httpStatus: payload.httpStatus as number,
                  pageIndex: payload.pageIndex as number,
                  responseBytes: BigInt(payload.responseBytes as number),
                }
              ),
            },
          })
        )
      );
    }
    default:
      throw new Error(
        `unsupported source api action command fixture: ${commandType}`
      );
  }
}

function encodeSourceApiActionEventPayload(
  eventType: string,
  payload: Record<string, unknown>
) {
  switch (eventType) {
    case "action_received":
      return Buffer.from(
        toBinary(
          SourceApiActionEventPayloadSchema,
          create(SourceApiActionEventPayloadSchema, {
            event: {
              case: "actionReceived",
              value: create(SourceApiActionReceivedEventSchema, {
                invokeMode: SourceApiActionInvokeMode.EXECUTE,
                requestDescriptor: toSourceApiRequestDescriptorMessage(
                  payload.requestDescriptor as Record<string, unknown>
                ),
                requestKind: SourceApiActionRequestKind.INVOKE,
              }),
            },
          })
        )
      );
    case "source_loaded":
      return Buffer.from(
        toBinary(
          SourceApiActionEventPayloadSchema,
          create(SourceApiActionEventPayloadSchema, {
            event: {
              case: "sourceLoaded",
              value: create(SourceApiActionSourceLoadedEventSchema, {
                source: toSourceApiSourceDescriptorMessage(
                  payload.source as Record<string, unknown>
                ),
              }),
            },
          })
        )
      );
    case "descriptor_resolved":
      return Buffer.from(
        toBinary(
          SourceApiActionEventPayloadSchema,
          create(SourceApiActionEventPayloadSchema, {
            event: {
              case: "descriptorResolved",
              value: create(SourceApiActionDescriptorResolvedEventSchema, {
                requestDescriptor: toSourceApiRequestDescriptorMessage(
                  payload.requestDescriptor as Record<string, unknown>
                ),
              }),
            },
          })
        )
      );
    case "request_prepared":
      return Buffer.from(
        toBinary(
          SourceApiActionEventPayloadSchema,
          create(SourceApiActionEventPayloadSchema, {
            event: {
              case: "requestPrepared",
              value: create(SourceApiActionRequestPreparedEventSchema, {
                preparedRequestFingerprint:
                  payload.preparedRequestFingerprint as string,
              }),
            },
          })
        )
      );
    case "page_fetch_succeeded":
      return Buffer.from(
        toBinary(
          SourceApiActionEventPayloadSchema,
          create(SourceApiActionEventPayloadSchema, {
            event: {
              case: "pageFetchSucceeded",
              value: create(SourceApiActionPageFetchSucceededEventSchema, {
                attemptNumber: payload.attemptNumber as number,
                contentType: payload.contentType as string,
                hasContinuation: payload.hasContinuation as boolean,
                httpStatus: payload.httpStatus as number,
                pageIndex: payload.pageIndex as number,
                responseBytes: BigInt(payload.responseBytes as number),
              }),
            },
          })
        )
      );
    default:
      throw new Error(
        `unsupported source api action event fixture: ${eventType}`
      );
  }
}

function encodeWorkflowCommandPayload(input: {
  commandPayload: Record<string, unknown>;
  commandType: string;
  family: "query_action" | "source_api_action";
}) {
  return input.family === "query_action"
    ? encodeQueryActionCommandPayload(input.commandType, input.commandPayload)
    : encodeSourceApiActionCommandPayload(
        input.commandType,
        input.commandPayload
      );
}

function encodeWorkflowEventPayload(input: {
  eventType: string;
  family: "query_action" | "source_api_action";
  payload: Record<string, unknown>;
}) {
  return input.family === "query_action"
    ? encodeQueryActionEventPayload(input.eventType, input.payload)
    : encodeSourceApiActionEventPayload(input.eventType, input.payload);
}

async function insertAcceptedWorkflowCommand(input: {
  actionId: string;
  actorSnapshot: WorkflowActorSnapshot;
  commandId: string;
  commandInvocationId: string;
  commandPayload: Record<string, unknown>;
  commandType: string;
  createdAt: Date;
  db: TestDatabase;
  family: "query_action" | "source_api_action";
  organizationId: string;
  requestId: string;
  surface: "cli" | "web" | "agent" | "system";
}) {
  await input.db.insert(workflowJournal).values({
    actorSnapshotJson: input.actorSnapshot,
    causedByEventId: null,
    commandInvocationId: input.commandInvocationId,
    commitId: input.commandId,
    entryKind: "command",
    family: input.family,
    id: input.commandId,
    occurredAt: input.createdAt,
    organizationId: input.organizationId,
    payloadBytes: encodeWorkflowCommandPayload({
      commandPayload: input.commandPayload,
      commandType: input.commandType,
      family: input.family,
    }),
    payloadType: input.commandType,
    requestId: input.requestId,
    streamId: input.actionId,
    streamPosition: nextJournalStreamPosition(input.actionId),
    surface: input.surface,
  });
}

async function insertWorkflowEventRows<
  Row extends {
    actionId: string;
    commandId: string;
    eventType: string;
    id: string;
    occurredAt: Date;
    payload: Record<string, unknown>;
  },
>(input: {
  db: TestDatabase;
  family: "query_action" | "source_api_action";
  organizationId: string;
  rows: readonly Row[];
}) {
  await input.db.insert(workflowJournal).values(
    input.rows.map((row) => ({
      commitId: row.commandId,
      entryKind: "event" as const,
      eventId: row.id,
      eventType: row.eventType,
      family: input.family,
      id: `${row.id}-journal`,
      occurredAt: row.occurredAt,
      organizationId: input.organizationId,
      payloadBytes: encodeWorkflowEventPayload({
        eventType: row.eventType,
        family: input.family,
        payload: row.payload,
      }),
      payloadType: row.eventType,
      streamId: row.actionId,
      streamPosition: nextJournalStreamPosition(row.actionId),
    }))
  );
}

async function seedSucceededQueryAction(input: {
  actionId: string;
  actorSnapshot: WorkflowActorSnapshot;
  db: TestDatabase;
  organizationId: string;
  requestId: string;
  startedAt: Date;
}) {
  const actionId = input.actionId;
  const eventBase = `${actionId}-event`;
  const commandBase = `${actionId}-command`;
  const source = {
    ...sourceDescriptor,
    organizationId: input.organizationId,
  };

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-start`,
    commandInvocationId: `${actionId}:start_execute`,
    commandPayload: {
      queryText: "select * from customers",
      sourceKey: source.sourceKey,
    },
    commandType: "start_execute",
    createdAt: input.startedAt,
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "cli",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-source`,
    commandInvocationId: `${actionId}:record_source_lookup`,
    commandPayload: {
      kind: "found",
      source,
    },
    commandType: "record_source_lookup",
    createdAt: new Date(input.startedAt.getTime() + 1_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-validated`,
    commandInvocationId: `${actionId}:record_query_validation`,
    commandPayload: {
      kind: "accepted",
      validatedQuery: "select * from customers",
    },
    commandType: "record_query_validation",
    createdAt: new Date(input.startedAt.getTime() + 2_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-credentials`,
    commandInvocationId: `${actionId}:record_credentials_load`,
    commandPayload: {
      kind: "loaded",
    },
    commandType: "record_credentials_load",
    createdAt: new Date(input.startedAt.getTime() + 3_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-executed`,
    commandInvocationId: `${actionId}:record_query_execution`,
    commandPayload: {
      kind: "succeeded",
      response: {
        columns: [],
        elapsedMs: 412,
        rowCount: 12,
        rows: [],
        source: {
          displayName: source.displayName,
          id: source.sourceId,
          provider: source.provider,
          sourceKey: source.sourceKey,
          status: source.sourceStatus,
        },
        truncated: false,
      },
    },
    commandType: "record_query_execution",
    createdAt: new Date(input.startedAt.getTime() + 4_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-usage`,
    commandInvocationId: `${actionId}:record_usage_persistence`,
    commandPayload: {
      kind: "succeeded",
    },
    commandType: "record_usage_persistence",
    createdAt: new Date(input.startedAt.getTime() + 5_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await input.db.insert(queryActions).values({
    completedAt: new Date(input.startedAt.getTime() + 5_000),
    failureCode: null,
    id: actionId,
    lastEventId: `${eventBase}-usage`,
    lastEventSequence: 6,
    organizationId: input.organizationId,
    outcome: "succeeded",
    phase: "completed",
    queryMode: "execute",
    queryText: "select * from customers",
    sourceDescriptorJson: source,
    startedAt: input.startedAt,
    usageRecordingStatus: "succeeded",
    validatedQuery: "select * from customers",
  });

  await insertWorkflowEventRows({
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    rows: [
      {
        actionId,
        commandId: `${commandBase}-start`,
        eventType: "action_received",
        id: `${eventBase}-start`,
        occurredAt: input.startedAt,
        payload: {
          queryMode: "execute",
          queryText: "select * from customers",
        },
      },
      {
        actionId,
        commandId: `${commandBase}-source`,
        eventType: "source_loaded",
        id: `${eventBase}-source`,
        occurredAt: new Date(input.startedAt.getTime() + 1_000),
        payload: {
          source,
        },
      },
      {
        actionId,
        commandId: `${commandBase}-validated`,
        eventType: "query_validated",
        id: `${eventBase}-validated`,
        occurredAt: new Date(input.startedAt.getTime() + 2_000),
        payload: {
          validatedQuery: "select * from customers",
        },
      },
      {
        actionId,
        commandId: `${commandBase}-credentials`,
        eventType: "credentials_loaded",
        id: `${eventBase}-credentials`,
        occurredAt: new Date(input.startedAt.getTime() + 3_000),
        payload: {},
      },
      {
        actionId,
        commandId: `${commandBase}-executed`,
        eventType: "query_executed",
        id: `${eventBase}-executed`,
        occurredAt: new Date(input.startedAt.getTime() + 4_000),
        payload: {
          elapsedMs: 412,
          rowCount: 12,
        },
      },
      {
        actionId,
        commandId: `${commandBase}-usage`,
        eventType: "usage_persisted",
        id: `${eventBase}-usage`,
        occurredAt: new Date(input.startedAt.getTime() + 5_000),
        payload: {},
      },
    ],
  });
}

async function seedQueryPreparationFailedAction(input: {
  actionId: string;
  actorSnapshot: WorkflowActorSnapshot;
  db: TestDatabase;
  organizationId: string;
  requestId: string;
  startedAt: Date;
}) {
  const actionId = input.actionId;
  const eventBase = `${actionId}-event`;
  const commandBase = `${actionId}-command`;
  const source = {
    ...sourceDescriptor,
    displayName: "Billing Warehouse",
    name: "billing",
    organizationId: input.organizationId,
    sourceId: "source-billing",
    sourceKey: "billing",
  };

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-start`,
    commandInvocationId: `${actionId}:start_validate`,
    commandPayload: {
      queryText: "select from",
      sourceKey: source.sourceKey,
    },
    commandType: "start_validate",
    createdAt: input.startedAt,
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "cli",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-source`,
    commandInvocationId: `${actionId}:record_source_lookup`,
    commandPayload: {
      kind: "found",
      source,
    },
    commandType: "record_source_lookup",
    createdAt: new Date(input.startedAt.getTime() + 1_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-preparation-failed`,
    commandInvocationId: `${actionId}:record_query_validation`,
    commandPayload: {
      detail: "query preparation failed",
      hint: "add a table name",
      kind: "preparation_failed",
    },
    commandType: "record_query_validation",
    createdAt: new Date(input.startedAt.getTime() + 2_000),
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await input.db.insert(queryActions).values({
    completedAt: new Date(input.startedAt.getTime() + 2_000),
    failureCode: "query_preparation_failed",
    id: actionId,
    lastEventId: `${eventBase}-preparation-failed`,
    lastEventSequence: 3,
    organizationId: input.organizationId,
    outcome: "failed",
    phase: "completed",
    queryMode: "validate",
    queryText: "select from",
    sourceDescriptorJson: source,
    startedAt: input.startedAt,
    usageRecordingStatus: "not_started",
    validatedQuery: null,
  });

  await insertWorkflowEventRows({
    db: input.db,
    family: "query_action",
    organizationId: input.organizationId,
    rows: [
      {
        actionId,
        commandId: `${commandBase}-start`,
        eventType: "action_received",
        id: `${eventBase}-start`,
        occurredAt: input.startedAt,
        payload: {
          queryMode: "validate",
          queryText: "select from",
        },
      },
      {
        actionId,
        commandId: `${commandBase}-source`,
        eventType: "source_loaded",
        id: `${eventBase}-source`,
        occurredAt: new Date(input.startedAt.getTime() + 1_000),
        payload: {
          source,
        },
      },
      {
        actionId,
        commandId: `${commandBase}-preparation-failed`,
        eventType: "query_preparation_failed",
        id: `${eventBase}-preparation-failed`,
        occurredAt: new Date(input.startedAt.getTime() + 2_000),
        payload: {
          detail: "query preparation failed",
          hint: "add a table name",
        },
      },
    ],
  });
}

async function seedPendingSourceApiAction(input: {
  actionId: string;
  actorSnapshot: WorkflowActorSnapshot;
  db: TestDatabase;
  organizationId: string;
  requestId: string;
  startedAt: Date;
}) {
  const actionId = input.actionId;
  const eventBase = `${actionId}-event`;
  const commandBase = `${actionId}-command`;

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-start`,
    commandInvocationId: `${actionId}:start_invoke`,
    commandPayload: {
      invokeMode: "execute",
      requestDescriptor,
      sourceKey: sourceApiDescriptor.sourceKey,
    },
    commandType: "start_invoke",
    createdAt: input.startedAt,
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "web",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-source`,
    commandInvocationId: `${actionId}:record_source_lookup`,
    commandPayload: {
      kind: "found",
      source: sourceApiDescriptor,
    },
    commandType: "record_source_lookup",
    createdAt: new Date(input.startedAt.getTime() + 1_000),
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-descriptor`,
    commandInvocationId: `${actionId}:record_descriptor_resolution`,
    commandPayload: {
      kind: "resolved",
      requestDescriptor,
    },
    commandType: "record_descriptor_resolution",
    createdAt: new Date(input.startedAt.getTime() + 2_000),
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-prepared`,
    commandInvocationId: `${actionId}:record_request_preparation`,
    commandPayload: {
      kind: "prepared",
      preparedRequestFingerprint: "billing-api:customers:v1",
    },
    commandType: "record_request_preparation",
    createdAt: new Date(input.startedAt.getTime() + 3_000),
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await insertAcceptedWorkflowCommand({
    actionId,
    actorSnapshot: input.actorSnapshot,
    commandId: `${commandBase}-fetch`,
    commandInvocationId: `${actionId}:record_page_fetch`,
    commandPayload: {
      attemptNumber: 1,
      contentType: "application/json",
      executionResult: {
        body: {
          kind: "json",
          value: {
            customers: [],
          },
        },
        contentType: "application/json",
        headers: [],
        nextContinuationState: {
          cursor: "page-2",
        },
        operation: "list_customers",
        selector: "/customers",
        source: {
          displayName: sourceApiDescriptor.displayName,
          provider: sourceApiDescriptor.provider,
          sourceKey: sourceApiDescriptor.sourceKey,
        },
        status: 200,
      },
      hasContinuation: true,
      httpStatus: 200,
      kind: "succeeded",
      pageIndex: 0,
      responseBytes: 16,
    },
    commandType: "record_page_fetch",
    createdAt: new Date("2026-03-27T11:00:00.000Z"),
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    requestId: input.requestId,
    surface: "system",
  });

  await input.db.insert(sourceApiActions).values({
    attemptNumber: 1,
    completedAt: null,
    failureCode: null,
    id: actionId,
    invokeMode: "execute",
    lastEventId: `${eventBase}-fetch`,
    lastEventSequence: 5,
    organizationId: input.organizationId,
    outcome: "pending",
    pageProgressJson: {
      nextPageIndex: 1,
    },
    phase: "await_resume",
    preparedRequestFingerprint: "billing-api:customers:v1",
    requestDescriptorJson: requestDescriptor,
    requestKind: "invoke",
    sourceDescriptorJson: sourceApiDescriptor,
    startedAt: input.startedAt,
  });

  await insertWorkflowEventRows({
    db: input.db,
    family: "source_api_action",
    organizationId: input.organizationId,
    rows: [
      {
        actionId,
        commandId: `${commandBase}-start`,
        eventType: "action_received",
        id: `${eventBase}-start`,
        occurredAt: input.startedAt,
        payload: {
          invokeMode: "execute",
          requestDescriptor,
          requestKind: "invoke",
        },
      },
      {
        actionId,
        commandId: `${commandBase}-source`,
        eventType: "source_loaded",
        id: `${eventBase}-source`,
        occurredAt: new Date(input.startedAt.getTime() + 1_000),
        payload: {
          source: sourceApiDescriptor,
        },
      },
      {
        actionId,
        commandId: `${commandBase}-descriptor`,
        eventType: "descriptor_resolved",
        id: `${eventBase}-descriptor`,
        occurredAt: new Date(input.startedAt.getTime() + 2_000),
        payload: {
          requestDescriptor,
        },
      },
      {
        actionId,
        commandId: `${commandBase}-prepared`,
        eventType: "request_prepared",
        id: `${eventBase}-prepared`,
        occurredAt: new Date(input.startedAt.getTime() + 3_000),
        payload: {
          preparedRequestFingerprint: "billing-api:customers:v1",
        },
      },
      {
        actionId,
        commandId: `${commandBase}-fetch`,
        eventType: "page_fetch_succeeded",
        id: `${eventBase}-fetch`,
        occurredAt: new Date("2026-03-27T11:00:00.000Z"),
        payload: {
          attemptNumber: 1,
          contentType: "application/json",
          hasContinuation: true,
          httpStatus: 200,
          pageIndex: 0,
          responseBytes: 16,
        },
      },
    ],
  });
}

describe("organizations audit route", () => {
  it("projects mixed-family actions, paginates by startedAt, filters on projection fields, and rebuilds after truncation", async () => {
    const harness = await createRouteIntegrationHarness({
      databaseUrl: await createPgliteDatabaseUrl("onequery-org-audit-"),
    });

    expect(harness.isOk()).toBe(true);
    if (harness.isErr()) {
      return;
    }

    const { client, db, test } = harness.value;

    const runId = createRunId();
    const owner = test.createUser({
      email: `audit-owner-${runId}@example.com`,
    });
    const organization = test.createOrganization({
      name: `Audit Route ${runId}`,
      slug: `audit-route-${runId}`,
    });

    await test.saveUser(owner);

    try {
      await test.saveOrganization(organization);
      await test.addMember({
        organizationId: organization.id as string,
        role: "owner",
        userId: owner.id,
      });

      const ownerLogin = await test.login({ userId: owner.id });
      const ownerCookie = ownerLogin.headers.get("cookie");

      if (!ownerCookie) {
        throw new Error("Owner login must expose a cookie header");
      }

      const actorSnapshot: WorkflowActorSnapshot = {
        authMode: "browser_session",
        email: owner.email,
        membershipRoles: ["owner"],
        userId: owner.id,
      };

      await seedSucceededQueryAction({
        actionId: `query-success-${runId}`,
        actorSnapshot,
        db,
        organizationId: organization.id as string,
        requestId: `req-query-success-${runId}`,
        startedAt: new Date("2026-03-27T10:00:00.000Z"),
      });

      await seedQueryPreparationFailedAction({
        actionId: `query-preparation-failed-${runId}`,
        actorSnapshot,
        db,
        organizationId: organization.id as string,
        requestId: `req-query-preparation-failed-${runId}`,
        startedAt: new Date("2026-03-27T09:00:00.000Z"),
      });

      await seedPendingSourceApiAction({
        actionId: `source-api-pending-${runId}`,
        actorSnapshot,
        db,
        organizationId: organization.id as string,
        requestId: `req-source-api-${runId}`,
        startedAt: new Date("2026-03-27T09:30:00.000Z"),
      });

      const firstPageResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            limit: "1",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      if (firstPageResponse.status !== 200) {
        throw new Error(
          `Expected audit first page to return 200, got ${
            firstPageResponse.status
          }: ${await firstPageResponse.text()}`
        );
      }

      const firstPage = auditListResponseSchema.parse(
        await firstPageResponse.json()
      );
      const firstItem = firstPage.items[0];

      expect(firstPage.projectionLag).toEqual({
        queryAction: false,
        sourceApiAction: false,
      });
      expect(firstPage.projectedThrough.queryAction).not.toBeNull();
      expect(firstPage.projectedThrough.sourceApiAction).not.toBeNull();
      expect(firstPage.items).toHaveLength(1);
      expect(firstItem).toBeDefined();
      if (!firstItem || !firstItem.preview) {
        throw new Error("first audit page must include a preview");
      }
      expect(firstItem).toMatchObject({
        actionName: "execute",
        family: "query_action",
        familyActionId: `query-success-${runId}`,
        id: `query_action:query-success-${runId}`,
        outcome: "succeeded",
        startedAt: "2026-03-27T10:00:00.000Z",
      });
      expect(firstItem.preview).toMatchObject({
        elapsedMs: 412,
        queryText: "select * from customers",
        rowCount: 12,
        usageRecordingStatus: "succeeded",
        validatedQuery: "select * from customers",
      });
      expect(firstItem.preview).not.toHaveProperty("errorDetail");
      expect(firstItem.preview).not.toHaveProperty("errorHint");
      expect(firstPage.families).toEqual(["query_action"]);
      expect(firstPage.nextCursor).not.toBeNull();

      const secondPageResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            cursor: firstPage.nextCursor ?? "",
            limit: "1",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(secondPageResponse.status).toBe(200);

      const secondPage = auditListResponseSchema.parse(
        await secondPageResponse.json()
      );
      const secondItem = secondPage.items[0];

      expect(secondPage.items).toHaveLength(1);
      expect(secondItem).toBeDefined();
      if (!secondItem || !secondItem.preview) {
        throw new Error("second audit page must include a preview");
      }
      expect(secondItem).toMatchObject({
        actionName: "invoke",
        family: "source_api_action",
        familyActionId: `source-api-pending-${runId}`,
        id: `source_api_action:source-api-pending-${runId}`,
        lastEventAt: "2026-03-27T11:00:00.000Z",
        outcome: "pending",
        startedAt: "2026-03-27T09:30:00.000Z",
      });
      expect(secondItem.preview).toMatchObject({
        attemptNumber: 1,
        httpStatus: 200,
        invokeMode: "execute",
        method: "GET",
        operation: "list_customers",
        pageCount: 1,
        selector: "/customers",
      });
      expect(secondItem.preview).not.toHaveProperty("errorDetail");
      expect(secondItem.preview).not.toHaveProperty("responseBytes");
      expect(secondPage.nextCursor).not.toBeNull();

      const filteredResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            family: "source_api_action",
            outcome: "pending",
            q: "customers",
            sourceKey: "billing-api",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(filteredResponse.status).toBe(200);

      const filtered = auditListResponseSchema.parse(
        await filteredResponse.json()
      );

      expect(filtered.items).toHaveLength(1);
      expect(filtered.items[0]).toMatchObject({
        family: "source_api_action",
        familyActionId: `source-api-pending-${runId}`,
        id: `source_api_action:source-api-pending-${runId}`,
        outcome: "pending",
        target: {
          sourceKey: "billing-api",
        },
      });

      const sanitizedActionResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            actionName: "execute",
            family: "source_api_action",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(sanitizedActionResponse.status).toBe(200);

      const sanitizedActionPage = auditListResponseSchema.parse(
        await sanitizedActionResponse.json()
      );

      expect(sanitizedActionPage.items).toHaveLength(1);
      expect(sanitizedActionPage.items[0]).toMatchObject({
        actionName: "invoke",
        family: "source_api_action",
        familyActionId: `source-api-pending-${runId}`,
      });

      const hiddenHintResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            q: "add a table name",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(hiddenHintResponse.status).toBe(200);

      const hiddenHintPage = auditListResponseSchema.parse(
        await hiddenHintResponse.json()
      );

      expect(hiddenHintPage.items).toHaveLength(0);

      await db.delete(auditFeedEntries);
      await db.delete(auditProjectionCheckpoints);

      const rebuiltResponse = await client.api.organizations[
        ":slug"
      ].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            limit: "3",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(rebuiltResponse.status).toBe(200);

      const rebuilt = auditListResponseSchema.parse(
        await rebuiltResponse.json()
      );

      expect(rebuilt.items.map((item) => item.id)).toEqual([
        `query_action:query-success-${runId}`,
        `source_api_action:source-api-pending-${runId}`,
        `query_action:query-preparation-failed-${runId}`,
      ]);

      const detailResponse = await client.api.organizations[":slug"].audit[
        ":family"
      ][":actionId"].$get(
        {
          param: {
            actionId: `query-success-${runId}`,
            family: "query_action",
            slug: organization.slug as string,
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(detailResponse.status).toBe(200);

      const detail = auditActionDetailSchema.parse(await detailResponse.json());

      expect(detail.commands[0]).toMatchObject({
        commandPayload: {
          byteLength: expect.any(Number),
        },
        commandType: "start_execute",
        decodedPayload: {
          startExecute: {
            queryText: "select * from customers",
            sourceKey: "warehouse",
          },
        },
      });
      expect(detail.events[0]).toMatchObject({
        decodedPayload: {
          actionReceived: {
            queryMode: "QUERY_ACTION_MODE_EXECUTE",
            queryText: "select * from customers",
          },
        },
        eventType: "action_received",
        payload: {
          byteLength: expect.any(Number),
        },
      });
    } finally {
      await closeDatabase(db as ClosableDatabase);
    }
  });

  it("rejects unauthenticated and unauthorized audit reads and returns 404 for unknown orgs", async () => {
    const harness = await createRouteIntegrationHarness({
      databaseUrl: await createPgliteDatabaseUrl("onequery-org-audit-access-"),
    });

    expect(harness.isOk()).toBe(true);
    if (harness.isErr()) {
      return;
    }

    const { client, db, test } = harness.value;

    const runId = createRunId();
    const owner = test.createUser({
      email: `audit-access-owner-${runId}@example.com`,
    });
    const outsider = test.createUser({
      email: `audit-access-outsider-${runId}@example.com`,
    });
    const organization = test.createOrganization({
      name: `Audit Access ${runId}`,
      slug: `audit-access-${runId}`,
    });

    await test.saveUser(owner);
    await test.saveUser(outsider);

    try {
      await test.saveOrganization(organization);
      await test.addMember({
        organizationId: organization.id as string,
        role: "owner",
        userId: owner.id,
      });

      const outsiderLogin = await test.login({ userId: outsider.id });
      const outsiderCookie = outsiderLogin.headers.get("cookie");

      if (!outsiderCookie) {
        throw new Error("Outsider login must expose a cookie header");
      }

      const unauthenticated = await client.api.organizations[
        ":slug"
      ].audit.$get({
        param: {
          slug: organization.slug as string,
        },
        query: {},
      });
      expect(unauthenticated.status).toBe(401);

      const forbidden = await client.api.organizations[":slug"].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {},
        },
        {
          headers: { cookie: outsiderCookie },
        }
      );
      expect(forbidden.status).toBe(403);

      const ownerLogin = await test.login({ userId: owner.id });
      const ownerCookie = ownerLogin.headers.get("cookie");

      if (!ownerCookie) {
        throw new Error("Owner login must expose a cookie header");
      }

      const missing = await client.api.organizations[":slug"].audit.$get(
        {
          param: {
            slug: "missing-org",
          },
          query: {},
        },
        {
          headers: { cookie: ownerCookie },
        }
      );
      expect(missing.status).toBe(404);
    } finally {
      await closeDatabase(db as ClosableDatabase);
    }
  });

  it("reports when the audit projection is still behind the event log", async () => {
    const harness = await createRouteIntegrationHarness({
      databaseUrl: await createPgliteDatabaseUrl("onequery-org-audit-lag-"),
    });

    expect(harness.isOk()).toBe(true);
    if (harness.isErr()) {
      return;
    }

    const { client, db, test } = harness.value;
    const runId = createRunId();
    const owner = test.createUser({
      email: `audit-lag-owner-${runId}@example.com`,
    });
    const organization = test.createOrganization({
      name: `Audit Lag ${runId}`,
      slug: `audit-lag-${runId}`,
    });

    await test.saveUser(owner);

    try {
      await test.saveOrganization(organization);
      await test.addMember({
        organizationId: organization.id as string,
        role: "owner",
        userId: owner.id,
      });

      const ownerLogin = await test.login({ userId: owner.id });
      const ownerCookie = ownerLogin.headers.get("cookie");

      if (!ownerCookie) {
        throw new Error("Owner login must expose a cookie header");
      }

      const actorSnapshot: WorkflowActorSnapshot = {
        authMode: "browser_session",
        email: owner.email,
        membershipRoles: ["owner"],
        userId: owner.id,
      };

      for (let index = 0; index < 168; index += 1) {
        await seedSucceededQueryAction({
          actionId: `query-lag-${runId}-${index}`,
          actorSnapshot,
          db,
          organizationId: organization.id as string,
          requestId: `req-query-lag-${runId}-${index}`,
          startedAt: new Date(Date.UTC(2026, 2, 27, 8, 0, index)),
        });
      }

      const firstResponse = await client.api.organizations[":slug"].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            limit: "1",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(firstResponse.status).toBe(200);

      const firstPage = auditListResponseSchema.parse(
        await firstResponse.json()
      );

      expect(firstPage.projectionLag).toEqual({
        queryAction: true,
        sourceApiAction: false,
      });

      const secondResponse = await client.api.organizations[":slug"].audit.$get(
        {
          param: {
            slug: organization.slug as string,
          },
          query: {
            limit: "1",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(secondResponse.status).toBe(200);

      const secondPage = auditListResponseSchema.parse(
        await secondResponse.json()
      );

      expect(secondPage.projectionLag).toEqual({
        queryAction: false,
        sourceApiAction: false,
      });
    } finally {
      await closeDatabase(db as ClosableDatabase);
    }
  });

  it("scopes projection lag to the current organization", async () => {
    const harness = await createRouteIntegrationHarness({
      databaseUrl: await createPgliteDatabaseUrl(
        "onequery-org-audit-lag-scope-"
      ),
    });

    expect(harness.isOk()).toBe(true);
    if (harness.isErr()) {
      return;
    }

    const { client, db, test } = harness.value;
    const runId = createRunId();
    const owner = test.createUser({
      email: `audit-lag-scope-owner-${runId}@example.com`,
    });
    const visibleOrganization = test.createOrganization({
      name: `Audit Lag Visible ${runId}`,
      slug: `audit-lag-visible-${runId}`,
    });
    const laggingOrganization = test.createOrganization({
      name: `Audit Lag Hidden ${runId}`,
      slug: `audit-lag-hidden-${runId}`,
    });

    await test.saveUser(owner);

    try {
      await test.saveOrganization(visibleOrganization);
      await test.saveOrganization(laggingOrganization);
      await test.addMember({
        organizationId: visibleOrganization.id as string,
        role: "owner",
        userId: owner.id,
      });
      await test.addMember({
        organizationId: laggingOrganization.id as string,
        role: "owner",
        userId: owner.id,
      });

      const ownerLogin = await test.login({ userId: owner.id });
      const ownerCookie = ownerLogin.headers.get("cookie");

      if (!ownerCookie) {
        throw new Error("Owner login must expose a cookie header");
      }

      const actorSnapshot: WorkflowActorSnapshot = {
        authMode: "browser_session",
        email: owner.email,
        membershipRoles: ["owner"],
        userId: owner.id,
      };

      await seedSucceededQueryAction({
        actionId: `query-visible-${runId}`,
        actorSnapshot,
        db,
        organizationId: visibleOrganization.id as string,
        requestId: `req-query-visible-${runId}`,
        startedAt: new Date("2026-03-27T08:00:00.000Z"),
      });

      for (let index = 0; index < 168; index += 1) {
        // Comment: This second org intentionally exceeds the per-request
        // projection batch cap so the visible org only stays warning-free when
        // lag detection is scoped to the requesting organization.
        await seedSucceededQueryAction({
          actionId: `query-hidden-${runId}-${index}`,
          actorSnapshot,
          db,
          organizationId: laggingOrganization.id as string,
          requestId: `req-query-hidden-${runId}-${index}`,
          startedAt: new Date(Date.UTC(2026, 2, 27, 9, 0, index)),
        });
      }

      const response = await client.api.organizations[":slug"].audit.$get(
        {
          param: {
            slug: visibleOrganization.slug as string,
          },
          query: {
            limit: "1",
          },
        },
        {
          headers: { cookie: ownerCookie },
        }
      );

      expect(response.status).toBe(200);

      const page = auditListResponseSchema.parse(await response.json());

      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        family: "query_action",
        familyActionId: `query-visible-${runId}`,
      });
      expect(page.projectionLag).toEqual({
        queryAction: false,
        sourceApiAction: false,
      });
    } finally {
      await closeDatabase(db as ClosableDatabase);
    }
  });
});
