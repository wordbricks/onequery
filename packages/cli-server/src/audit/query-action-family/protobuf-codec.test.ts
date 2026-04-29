import { create, toBinary } from "@bufbuild/protobuf";
import {
  WorkflowDataSourceStatus,
  WorkflowSourceProvider,
} from "@onequery/proto-workflow/workflow/v1/common_pb";
import {
  QueryActionCommandPayloadSchema,
  QueryActionEventPayloadSchema,
  QueryActionMode as ProtoQueryActionMode,
  QueryActionQueryLogicalType as ProtoQueryLogicalType,
  QueryActionQueryColumnSchema,
  QueryActionQueryExecutedEventSchema,
  QueryActionReceivedEventSchema,
  QueryActionRecordQueryExecutionResultSchema,
  QueryActionRecordQueryExecutionSucceededCommandSchema,
  QueryActionQuerySourceRecordSchema,
  QueryActionRecordSourceQueryInterfaceMissingCommandSchema,
  QueryActionStartValidateCommandSchema,
} from "@onequery/proto-workflow/workflow/v1/query_action_pb";
import type { Result as ResultType } from "better-result";
import { describe, expect, it } from "vitest";

import { WorkflowStorageCorruptRowError } from "../storage/errors";
import type { QueryActionCommandPayload } from "./commands";
import type { QueryActionSourceDescriptor } from "./descriptors";
import type { QueryActionEffect } from "./effects";
import type { QueryActionEvent } from "./events";
import {
  decodeQueryActionCommandPayload,
  decodeQueryActionEffectPayload,
  decodeQueryActionEventPayload,
  encodeQueryActionCommandPayload,
  encodeQueryActionEffectPayload,
  encodeQueryActionEventPayload,
} from "./protobuf-codec";

const source: QueryActionSourceDescriptor = {
  displayName: null,
  name: "Warehouse",
  organizationId: "org_1",
  provider: "postgres",
  sourceId: "source_1",
  sourceKey: "warehouse",
  sourceStatus: "active",
};

const queryExecutionResponse = {
  columns: [
    {
      logicalType: "number" as const,
      name: "answer",
    },
    {
      logicalType: null,
      name: "payload",
    },
  ],
  elapsedMs: 18,
  rowCount: 2,
  rows: [
    ["42", '{"ok":true}'],
    ["7", "null"],
  ],
  source: {
    displayName: "Warehouse",
    id: "source_1",
    provider: "postgres" as const,
    sourceKey: "warehouse",
    status: "active" as const,
  },
  truncated: false,
};

const commandPayloads = [
  [
    "start_validate",
    "start_validate",
    {
      queryText: "select * from customers",
      sourceKey: "warehouse",
      type: "start_validate",
    },
  ],
  [
    "start_execute",
    "start_execute",
    {
      queryText: "select * from customers",
      sourceKey: "warehouse",
      type: "start_execute",
    },
  ],
  [
    "record_source_lookup/found",
    "record_source_found",
    {
      kind: "found",
      source,
      type: "record_source_lookup",
    },
  ],
  [
    "record_source_lookup/not_found",
    "record_source_not_found",
    {
      kind: "not_found",
      sourceKey: "warehouse",
      type: "record_source_lookup",
    },
  ],
  [
    "record_source_lookup/query_interface_missing",
    "record_source_query_interface_missing",
    {
      kind: "query_interface_missing",
      provider: "postgres",
      sourceStatus: "disconnected",
      type: "record_source_lookup",
    },
  ],
  [
    "record_query_validation/accepted",
    "record_query_validation_accepted",
    {
      kind: "accepted",
      truncated: false,
      type: "record_query_validation",
      validatedQuery: "SELECT * FROM customers LIMIT 1000",
    },
  ],
  [
    "record_query_validation/rejected",
    "record_query_validation_rejected",
    {
      detail: "query is read-only only",
      kind: "rejected",
      type: "record_query_validation",
    },
  ],
  [
    "record_query_validation/preparation_failed",
    "record_query_validation_preparation_failed",
    {
      detail: "validator unavailable",
      hint: "try again",
      kind: "preparation_failed",
      type: "record_query_validation",
    },
  ],
  [
    "record_credentials_load/loaded",
    "record_credentials_loaded",
    {
      kind: "loaded",
      type: "record_credentials_load",
    },
  ],
  [
    "record_credentials_load/preparation_failed",
    "record_credentials_preparation_failed",
    {
      detail: "credentials unavailable",
      hint: "reconnect source",
      kind: "preparation_failed",
      type: "record_credentials_load",
    },
  ],
  [
    "record_query_execution/succeeded",
    "record_query_execution_succeeded",
    {
      kind: "succeeded",
      response: queryExecutionResponse,
      type: "record_query_execution",
    },
  ],
  [
    "record_query_execution/unavailable",
    "record_query_execution_unavailable",
    {
      detail: "warehouse unavailable",
      kind: "unavailable",
      type: "record_query_execution",
    },
  ],
  [
    "record_query_execution/timed_out",
    "record_query_execution_timed_out",
    {
      detail: "warehouse timed out",
      kind: "timed_out",
      type: "record_query_execution",
    },
  ],
  [
    "record_query_execution/failed",
    "record_query_execution_failed",
    {
      detail: "warehouse returned an error",
      kind: "failed",
      type: "record_query_execution",
    },
  ],
  [
    "record_usage_persistence/succeeded",
    "record_usage_persistence_succeeded",
    {
      kind: "succeeded",
      type: "record_usage_persistence",
    },
  ],
  [
    "record_usage_persistence/failed",
    "record_usage_persistence_failed",
    {
      detail: "usage sink unavailable",
      kind: "failed",
      type: "record_usage_persistence",
    },
  ],
] satisfies ReadonlyArray<readonly [string, string, QueryActionCommandPayload]>;

const eventPayloads = [
  [
    "action_received",
    {
      queryMode: "execute",
      queryText: "select * from customers",
      type: "action_received",
    },
  ],
  [
    "source_loaded",
    {
      source,
      type: "source_loaded",
    },
  ],
  [
    "source_not_found",
    {
      sourceKey: "warehouse",
      type: "source_not_found",
    },
  ],
  [
    "source_query_interface_missing",
    {
      provider: "postgres",
      sourceStatus: "error",
      type: "source_query_interface_missing",
    },
  ],
  [
    "query_validated",
    {
      type: "query_validated",
      validatedQuery: "SELECT * FROM customers LIMIT 1000",
    },
  ],
  [
    "query_rejected",
    {
      detail: "query is read-only only",
      type: "query_rejected",
    },
  ],
  [
    "credentials_loaded",
    {
      type: "credentials_loaded",
    },
  ],
  [
    "query_preparation_failed",
    {
      detail: "validator unavailable",
      hint: "try again",
      type: "query_preparation_failed",
    },
  ],
  [
    "query_executed",
    {
      elapsedMs: 18,
      rowCount: 2,
      type: "query_executed",
    },
  ],
  [
    "query_unavailable",
    {
      detail: "warehouse unavailable",
      type: "query_unavailable",
    },
  ],
  [
    "query_timed_out",
    {
      detail: "warehouse timed out",
      type: "query_timed_out",
    },
  ],
  [
    "query_execution_failed",
    {
      detail: "warehouse returned an error",
      type: "query_execution_failed",
    },
  ],
  [
    "usage_persisted",
    {
      type: "usage_persisted",
    },
  ],
  [
    "usage_persist_failed",
    {
      detail: "usage sink unavailable",
      type: "usage_persist_failed",
    },
  ],
] satisfies ReadonlyArray<readonly [string, QueryActionEvent]>;

const effectPayloads = [
  [
    "load_source",
    {
      organizationId: "org_1",
      sourceKey: "warehouse",
      type: "load_source",
    },
  ],
  [
    "validate_query",
    {
      queryText: "select * from customers",
      source,
      type: "validate_query",
    },
  ],
  [
    "load_credentials",
    {
      source,
      type: "load_credentials",
    },
  ],
  [
    "execute_query",
    {
      source,
      type: "execute_query",
      validatedQuery: "SELECT * FROM customers LIMIT 1000",
    },
  ],
  [
    "persist_usage",
    {
      sourceId: "source_1",
      type: "persist_usage",
    },
  ],
] satisfies ReadonlyArray<readonly [string, QueryActionEffect]>;

function decodeContext(payloadType: string) {
  return {
    actionId: "query_action_1",
    commandId: "workflow_command_1",
    payloadType,
  };
}

function expectOk<T, E>(result: ResultType<T, E>): T {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

function expectCorruptRow<T>(
  result: ResultType<T, WorkflowStorageCorruptRowError>,
  expected: {
    entity: string;
    payloadType: string;
  }
) {
  expect(result.isErr()).toBe(true);
  if (result.isOk()) {
    throw new Error("expected corrupt workflow row");
  }

  expect(result.error).toBeInstanceOf(WorkflowStorageCorruptRowError);
  expect(result.error).toMatchObject({
    _tag: "WorkflowStorageCorruptRowError",
    actionId: "query_action_1",
    commandId: "workflow_command_1",
    entity: expected.entity,
    family: "query_action",
    payloadType: expected.payloadType,
  });

  return result.error;
}

function expectValidationCause(error: WorkflowStorageCorruptRowError) {
  const cause = error.cause;

  expect(cause).toBeInstanceOf(Error);
  if (!(cause instanceof Error)) {
    throw new Error("expected validation error cause");
  }
  expect(cause.constructor.name).toBe("ValidationError");

  return String(cause);
}

describe("query action protobuf codec", () => {
  it.each(commandPayloads)(
    "round-trips command payload %s through protobuf bytes",
    (_name, storageType, payload) => {
      const decoded = expectOk(
        decodeQueryActionCommandPayload(
          encodeQueryActionCommandPayload(payload),
          decodeContext(storageType)
        )
      );

      expect(decoded).toEqual(payload);
    }
  );

  it.each(eventPayloads)(
    "round-trips event payload %s through protobuf bytes",
    (_name, payload) => {
      const decoded = expectOk(
        decodeQueryActionEventPayload(
          encodeQueryActionEventPayload(payload),
          decodeContext(payload.type)
        )
      );

      expect(decoded).toEqual(payload);
    }
  );

  it.each(effectPayloads)(
    "round-trips effect payload %s through protobuf bytes",
    (_name, payload) => {
      const decoded = expectOk(
        decodeQueryActionEffectPayload(
          encodeQueryActionEffectPayload(payload),
          decodeContext(payload.type)
        )
      );

      expect(decoded).toEqual(payload);
    }
  );

  it("classifies invalid protobuf bytes as corrupt storage rows", () => {
    const error = expectCorruptRow(
      decodeQueryActionCommandPayload(
        Buffer.from([0xff]),
        decodeContext("start_validate")
      ),
      {
        entity: "query_action_command_payload",
        payloadType: "start_validate",
      }
    );

    expect(error.cause).toBeInstanceOf(RangeError);
  });

  it("classifies protovalidate failures as corrupt storage rows", () => {
    const bytes = Buffer.from(
      toBinary(
        QueryActionCommandPayloadSchema,
        create(QueryActionCommandPayloadSchema)
      )
    );

    const error = expectCorruptRow(
      decodeQueryActionCommandPayload(bytes, decodeContext("start_validate")),
      {
        entity: "query_action_command_payload",
        payloadType: "start_validate",
      }
    );

    expect(expectValidationCause(error)).toContain("required");
  });

  it("rejects unspecified generated enum values before domain conversion", () => {
    const bytes = Buffer.from(
      toBinary(
        QueryActionEventPayloadSchema,
        create(QueryActionEventPayloadSchema, {
          event: {
            case: "actionReceived",
            value: create(QueryActionReceivedEventSchema, {
              queryMode: ProtoQueryActionMode.UNSPECIFIED,
              queryText: "select 1",
            }),
          },
        })
      )
    );

    const error = expectCorruptRow(
      decodeQueryActionEventPayload(bytes, decodeContext("action_received")),
      {
        entity: "query_action_event_payload",
        payloadType: "action_received",
      }
    );

    expect(expectValidationCause(error)).toContain("enum.not_in");
  });

  it("rejects invalid generated enum values before domain conversion", () => {
    const bytes = Buffer.from(
      toBinary(
        QueryActionEventPayloadSchema,
        create(QueryActionEventPayloadSchema, {
          event: {
            case: "actionReceived",
            value: create(QueryActionReceivedEventSchema, {
              queryMode: 99 as ProtoQueryActionMode,
              queryText: "select 1",
            }),
          },
        })
      )
    );

    const error = expectCorruptRow(
      decodeQueryActionEventPayload(bytes, decodeContext("action_received")),
      {
        entity: "query_action_event_payload",
        payloadType: "action_received",
      }
    );

    expect(expectValidationCause(error)).toContain("enum.defined_only");
    expect(String(error.cause)).not.toContain("unsupported query action mode");
  });

  it("rejects optional enum UNSPECIFIED values during domain conversion", () => {
    const bytes = Buffer.from(
      toBinary(
        QueryActionCommandPayloadSchema,
        create(QueryActionCommandPayloadSchema, {
          command: {
            case: "recordQueryExecutionSucceeded",
            value: create(
              QueryActionRecordQueryExecutionSucceededCommandSchema,
              {
                response: create(QueryActionRecordQueryExecutionResultSchema, {
                  columns: [
                    create(QueryActionQueryColumnSchema, {
                      logicalType: ProtoQueryLogicalType.UNSPECIFIED,
                      name: "answer",
                    }),
                  ],
                  elapsed: { nanos: 0, seconds: 0n },
                  rowCount: 1,
                  rows: [],
                  source: create(QueryActionQuerySourceRecordSchema, {
                    displayName: "Warehouse",
                    provider: WorkflowSourceProvider.POSTGRES,
                    sourceId: "source_1",
                    sourceKey: "warehouse",
                    sourceStatus: WorkflowDataSourceStatus.ACTIVE,
                  }),
                  truncated: false,
                }),
              }
            ),
          },
        })
      )
    );

    const error = expectCorruptRow(
      decodeQueryActionCommandPayload(
        bytes,
        decodeContext("record_query_execution_succeeded")
      ),
      {
        entity: "query_action_command_payload",
        payloadType: "record_query_execution_succeeded",
      }
    );

    expect(error.cause).toBeInstanceOf(Error);
    expect(String(error.cause)).toContain("query logical type is unspecified");
  });

  it("rejects scalar payload type and protobuf oneof mismatches", () => {
    const bytes = encodeQueryActionCommandPayload({
      queryText: "select 1",
      sourceKey: "warehouse",
      type: "start_execute",
    });

    const error = expectCorruptRow(
      decodeQueryActionCommandPayload(bytes, decodeContext("start_validate")),
      {
        entity: "query_action_command_payload",
        payloadType: "start_validate",
      }
    );

    expect(error.cause).toBeInstanceOf(Error);
    expect(String(error.cause)).toContain(
      "stored scalar payload type 'start_validate' does not match protobuf payload type 'start_execute'"
    );

    const groupedBytes = encodeQueryActionCommandPayload({
      detail: "warehouse timed out",
      kind: "timed_out",
      type: "record_query_execution",
    });

    const groupedError = expectCorruptRow(
      decodeQueryActionCommandPayload(
        groupedBytes,
        decodeContext("record_query_execution_succeeded")
      ),
      {
        entity: "query_action_command_payload",
        payloadType: "record_query_execution_succeeded",
      }
    );

    expect(groupedError.cause).toBeInstanceOf(Error);
    expect(String(groupedError.cause)).toContain(
      "stored scalar payload type 'record_query_execution_succeeded' does not match protobuf payload type 'record_query_execution_timed_out'"
    );
  });

  it("decodes semantic effect equality without relying on protobuf byte equality", () => {
    const effect: QueryActionEffect = {
      organizationId: "org_1",
      sourceKey: "warehouse",
      type: "load_source",
    };
    const canonicalBytes = encodeQueryActionEffectPayload(effect);
    const bytesWithUnknownField = Buffer.concat([
      canonicalBytes,
      // Unknown top-level varint field 99. Domain conversion ignores it.
      Buffer.from([0x98, 0x06, 0x7b]),
    ]);

    expect(bytesWithUnknownField.equals(canonicalBytes)).toBe(false);
    expect(
      expectOk(
        decodeQueryActionEffectPayload(
          canonicalBytes,
          decodeContext(effect.type)
        )
      )
    ).toEqual(effect);
    expect(
      expectOk(
        decodeQueryActionEffectPayload(
          bytesWithUnknownField,
          decodeContext(effect.type)
        )
      )
    ).toEqual(effect);
  });

  it("classifies nested scalar/protobuf mismatches as corrupt storage rows", () => {
    const bytes = Buffer.from(
      toBinary(
        QueryActionCommandPayloadSchema,
        create(QueryActionCommandPayloadSchema, {
          command: {
            case: "recordSourceQueryInterfaceMissing",
            value: create(
              QueryActionRecordSourceQueryInterfaceMissingCommandSchema,
              {
                provider: WorkflowSourceProvider.POSTGRES,
                sourceStatus: WorkflowDataSourceStatus.UNSPECIFIED,
              }
            ),
          },
        })
      )
    );

    const error = expectCorruptRow(
      decodeQueryActionCommandPayload(
        bytes,
        decodeContext("record_source_query_interface_missing")
      ),
      {
        entity: "query_action_command_payload",
        payloadType: "record_source_query_interface_missing",
      }
    );

    expect(expectValidationCause(error)).toContain("source_status");
  });

  it("classifies missing required nested protobuf fields as corrupt storage rows", () => {
    const bytes = Buffer.from(
      toBinary(
        QueryActionCommandPayloadSchema,
        create(QueryActionCommandPayloadSchema, {
          command: {
            case: "startValidate",
            value: create(QueryActionStartValidateCommandSchema, {
              queryText: "select 1",
            }),
          },
        })
      )
    );

    const error = expectCorruptRow(
      decodeQueryActionCommandPayload(bytes, decodeContext("start_validate")),
      {
        entity: "query_action_command_payload",
        payloadType: "start_validate",
      }
    );

    expect(expectValidationCause(error)).toContain("source_key");
  });

  it("classifies missing required duration fields as corrupt storage rows", () => {
    const bytes = Buffer.from(
      toBinary(
        QueryActionEventPayloadSchema,
        create(QueryActionEventPayloadSchema, {
          event: {
            case: "queryExecuted",
            value: create(QueryActionQueryExecutedEventSchema, {
              rowCount: 1,
            }),
          },
        })
      )
    );

    const error = expectCorruptRow(
      decodeQueryActionEventPayload(bytes, decodeContext("query_executed")),
      {
        entity: "query_action_event_payload",
        payloadType: "query_executed",
      }
    );

    expect(expectValidationCause(error)).toContain("elapsed");
  });
});
