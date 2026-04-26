import { create, toBinary } from "@bufbuild/protobuf";
import type { SourceApiDescriptor } from "@onequery/server/source-api";
import type { Result as ResultType } from "better-result";
import { describe, expect, it } from "vitest";

import { WorkflowSourceProvider } from "../../connect/gen/onequery/workflow/v1/common_pb";
import * as sourceApiPb from "../../connect/gen/onequery/workflow/v1/source_api_action_pb";
import { WorkflowStorageCorruptRowError } from "../storage/errors";
import type { SourceApiActionCommandPayload } from "./commands";
import type {
  SourceApiActionRequestDescriptor,
  SourceApiActionSourceDescriptor,
  StoredSourceApiExecutionResult,
} from "./descriptors";
import type { SourceApiActionEffect } from "./effects";
import type { SourceApiActionEvent } from "./events";
import {
  decodeSourceApiActionCommandPayload,
  decodeSourceApiActionEffectPayload,
  decodeSourceApiActionEventPayload,
  encodeSourceApiActionCommandPayload,
  encodeSourceApiActionEffectPayload,
  encodeSourceApiActionEventPayload,
} from "./protobuf-codec";

const source: SourceApiActionSourceDescriptor = {
  displayName: "GitHub Prod",
  provider: "github",
  sourceId: "source_1",
  sourceKey: "github-prod",
};

const requestDescriptor: SourceApiActionRequestDescriptor = {
  descriptorVersion: "github-v1",
  kind: "http_request",
  method: "GET",
  operation: "fetch",
  paginationPolicy: "continuation_token",
  selector: "/issues",
};

const descriptor = {
  defaultPathOperation: "fetch",
  descriptorVersion: "github-v1",
  examples: [
    {
      command:
        "onequery source-api execute github-prod fetch --selector /issues",
      description: "Fetch issues",
      label: "Issues",
    },
  ],
  notes: ["Uses GitHub REST"],
  operations: [
    {
      description: "Fetch a GitHub path",
      examples: [
        {
          command:
            "onequery source-api execute github-prod fetch --selector /issues",
          label: "Issues",
        },
      ],
      fieldPolicy: {
        acceptsInput: false,
        allowsRawFields: false,
        allowsTypedFields: false,
        inputMode: "none",
        mergePatches: false,
        supportsArrayPaths: false,
        supportsNestedPaths: false,
      },
      headerPolicy: {
        allowedRequestHeaders: ["accept"],
        allowedResponseHeaders: ["content-type"],
      },
      kind: "http_request",
      methodPolicy: {
        allowedMethods: ["GET"],
        defaultMethod: "GET",
      },
      name: "fetch",
      notes: ["Returns provider response bytes"],
      paginationPolicy: "continuation_token",
      selectorKind: "path",
      selectorLabel: "path",
      summary: "Fetch path",
    },
  ],
  source: {
    displayName: "GitHub Prod",
    provider: "github",
    sourceKey: "github-prod",
  },
} satisfies SourceApiDescriptor;

const executionResult = {
  body: {
    kind: "binary",
    value: new Uint8Array([0, 1, 127, 255]),
  },
  contentType: "application/octet-stream",
  headers: [
    {
      name: "content-type",
      value: "application/octet-stream",
    },
  ],
  nextContinuationState: {
    cursor: "page_3",
    nested: [1, true, null],
  },
  operation: "fetch",
  selector: "/issues?page=2",
  source: {
    displayName: "GitHub Prod",
    provider: "github",
    sourceKey: "github-prod",
  },
  status: 206,
} satisfies StoredSourceApiExecutionResult;

const commandPayloads = [
  [
    "start_describe",
    "start_describe",
    {
      sourceKey: "github-prod",
      type: "start_describe",
    },
  ],
  [
    "start_invoke",
    "start_invoke",
    {
      invokeMode: "execute",
      requestDescriptor,
      sourceKey: "github-prod",
      type: "start_invoke",
    },
  ],
  [
    "resume_invoke",
    "resume_invoke",
    {
      preparedRequestFingerprint: "prepared_execute",
      resumeFromEventId: "event_1",
      type: "resume_invoke",
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
      sourceKey: "github-prod",
      type: "record_source_lookup",
    },
  ],
  [
    "record_descriptor_resolution/resolved",
    "record_descriptor_resolved",
    {
      descriptor,
      kind: "resolved",
      requestDescriptor,
      type: "record_descriptor_resolution",
    },
  ],
  [
    "record_descriptor_resolution/failed",
    "record_descriptor_resolution_failed",
    {
      detail: "descriptor denied",
      failureCode: "permission_denied",
      kind: "failed",
      type: "record_descriptor_resolution",
    },
  ],
  [
    "record_request_preparation/prepared",
    "record_request_prepared",
    {
      kind: "prepared",
      preparedRequestFingerprint: "prepared_execute",
      type: "record_request_preparation",
    },
  ],
  [
    "record_request_preparation/failed",
    "record_request_preparation_failed",
    {
      detail: "request invalid",
      failureCode: "invalid_request",
      kind: "failed",
      type: "record_request_preparation",
    },
  ],
  [
    "record_page_fetch/succeeded",
    "record_page_fetch_succeeded",
    {
      attemptNumber: 2,
      contentType: "application/octet-stream",
      executionResult,
      hasContinuation: true,
      httpStatus: 206,
      kind: "succeeded",
      pageIndex: 1,
      responseBytes: 4,
      type: "record_page_fetch",
    },
  ],
  [
    "record_page_fetch/terminal_failure",
    "record_page_fetch_terminal_failure",
    {
      attemptNumber: 2,
      detail: "provider timed out",
      failureCode: "request_timed_out",
      kind: "terminal_failure",
      pageIndex: 1,
      type: "record_page_fetch",
    },
  ],
] satisfies ReadonlyArray<
  readonly [string, string, SourceApiActionCommandPayload]
>;

const eventPayloads = [
  [
    "action_received",
    {
      invokeMode: "execute",
      requestDescriptor,
      requestKind: "invoke",
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
      sourceKey: "github-prod",
      type: "source_not_found",
    },
  ],
  [
    "descriptor_resolved",
    {
      requestDescriptor,
      type: "descriptor_resolved",
    },
  ],
  [
    "descriptor_resolution_failed",
    {
      detail: "descriptor denied",
      failureCode: "permission_denied",
      type: "descriptor_resolution_failed",
    },
  ],
  [
    "request_prepared",
    {
      preparedRequestFingerprint: "prepared_execute",
      type: "request_prepared",
    },
  ],
  [
    "request_preparation_failed",
    {
      detail: "request invalid",
      failureCode: "invalid_request",
      type: "request_preparation_failed",
    },
  ],
  [
    "resume_requested",
    {
      attemptNumber: 2,
      type: "resume_requested",
    },
  ],
  [
    "page_fetch_succeeded",
    {
      attemptNumber: 2,
      contentType: "application/octet-stream",
      hasContinuation: true,
      httpStatus: 206,
      pageIndex: 1,
      responseBytes: 4,
      type: "page_fetch_succeeded",
    },
  ],
  [
    "page_fetch_failed",
    {
      attemptNumber: 2,
      detail: "provider timed out",
      failureCode: "request_timed_out",
      kind: "terminal_failure",
      pageIndex: 1,
      type: "page_fetch_failed",
    },
  ],
] satisfies ReadonlyArray<readonly [string, SourceApiActionEvent]>;

const effectPayloads = [
  [
    "load_source",
    {
      organizationId: "org_1",
      sourceKey: "github-prod",
      type: "load_source",
    },
  ],
  [
    "resolve_descriptor",
    {
      source,
      type: "resolve_descriptor",
    },
  ],
  [
    "prepare_request",
    {
      requestDescriptor,
      source,
      type: "prepare_request",
    },
  ],
  [
    "execute_page",
    {
      attemptNumber: 2,
      pageIndex: 1,
      preparedRequestFingerprint: "prepared_execute",
      requestDescriptor,
      source,
      type: "execute_page",
    },
  ],
] satisfies ReadonlyArray<readonly [string, SourceApiActionEffect]>;

function decodeContext(payloadType: string) {
  return {
    actionId: "source_api_action_1",
    commandId: "workflow_command_1",
    payloadType,
  };
}

function normalizeBinaryValues(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return [...value];
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeBinaryValues(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeBinaryValues(item),
      ])
    );
  }

  return value;
}

function expectCorruptRow<T>(
  result: ResultType<T, WorkflowStorageCorruptRowError>
) {
  expect(result.isErr()).toBe(true);
  if (result.isOk()) {
    throw new Error("expected corrupt workflow row");
  }

  expect(result.error).toBeInstanceOf(WorkflowStorageCorruptRowError);
  expect(result.error).toMatchObject({
    _tag: "WorkflowStorageCorruptRowError",
    actionId: "source_api_action_1",
    commandId: "workflow_command_1",
    family: "source_api_action",
  });

  return result.error;
}

function expectOk<T, E>(result: ResultType<T, E>): T {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

describe("source api action protobuf codec", () => {
  it.each(commandPayloads)(
    "round-trips command payload %s through protobuf bytes",
    (_name, storageType, payload) => {
      const decoded = expectOk(
        decodeSourceApiActionCommandPayload(
          encodeSourceApiActionCommandPayload(payload),
          decodeContext(storageType)
        )
      );

      expect(normalizeBinaryValues(decoded)).toEqual(
        normalizeBinaryValues(payload)
      );
    }
  );

  it.each(eventPayloads)(
    "round-trips event payload %s through protobuf bytes",
    (_name, payload) => {
      const decoded = expectOk(
        decodeSourceApiActionEventPayload(
          encodeSourceApiActionEventPayload(payload),
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
        decodeSourceApiActionEffectPayload(
          encodeSourceApiActionEffectPayload(payload),
          decodeContext(payload.type)
        )
      );

      expect(decoded).toEqual(payload);
    }
  );

  it("normalizes replayed binary response bodies to Uint8Array", () => {
    const payload: SourceApiActionCommandPayload = {
      attemptNumber: 2,
      contentType: "application/octet-stream",
      executionResult,
      hasContinuation: true,
      httpStatus: 206,
      kind: "succeeded",
      pageIndex: 1,
      responseBytes: 4,
      type: "record_page_fetch",
    };

    const decoded = expectOk(
      decodeSourceApiActionCommandPayload(
        encodeSourceApiActionCommandPayload(payload),
        decodeContext("record_page_fetch_succeeded")
      )
    );

    if (decoded.type !== "record_page_fetch" || decoded.kind !== "succeeded") {
      throw new Error("expected decoded page fetch success command");
    }
    expect(decoded.type).toBe("record_page_fetch");
    expect(decoded.kind).toBe("succeeded");

    const body = decoded.executionResult.body;
    expect(body.kind).toBe("binary");
    if (body.kind !== "binary") {
      throw new Error("expected decoded binary body");
    }
    expect(body.value).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(body.value)).toBe(false);
    expect([...body.value]).toEqual([0, 1, 127, 255]);
  });

  it("classifies invalid protobuf bytes as corrupt storage rows", () => {
    const error = expectCorruptRow(
      decodeSourceApiActionCommandPayload(
        Buffer.from([0xff]),
        decodeContext("start_describe")
      )
    );

    expect(error).toMatchObject({
      entity: "source_api_action_command_payload",
      payloadType: "start_describe",
    });
  });

  it("classifies protovalidate failures as corrupt storage rows", () => {
    const bytes = Buffer.from(
      toBinary(
        sourceApiPb.SourceApiActionCommandPayloadSchema,
        create(sourceApiPb.SourceApiActionCommandPayloadSchema)
      )
    );

    const error = expectCorruptRow(
      decodeSourceApiActionCommandPayload(
        bytes,
        decodeContext("start_describe")
      )
    );

    expect(error).toMatchObject({
      entity: "source_api_action_command_payload",
      payloadType: "start_describe",
    });
  });

  it("rejects unspecified generated enum values before reducers see them", () => {
    const bytes = Buffer.from(
      toBinary(
        sourceApiPb.SourceApiActionEventPayloadSchema,
        create(sourceApiPb.SourceApiActionEventPayloadSchema, {
          event: {
            case: "sourceLoaded",
            value: create(sourceApiPb.SourceApiActionSourceLoadedEventSchema, {
              source: create(
                sourceApiPb.SourceApiActionSourceDescriptorSchema,
                {
                  displayName: "GitHub Prod",
                  provider: WorkflowSourceProvider.UNSPECIFIED,
                  sourceId: "source_1",
                  sourceKey: "github-prod",
                }
              ),
            }),
          },
        })
      )
    );
    const decoded = decodeSourceApiActionEventPayload(
      bytes,
      decodeContext("source_loaded")
    );

    expect(decoded.isErr()).toBe(true);
    if (decoded.isOk()) {
      throw new Error("expected unspecified provider enum to be rejected");
    }
    expect(decoded.error).toMatchObject({
      _tag: "WorkflowStorageCorruptRowError",
      entity: "source_api_action_event_payload",
      payloadType: "source_loaded",
    });
  });

  it("rejects invalid generated enum values before reducers see them", () => {
    const bytes = Buffer.from(
      toBinary(
        sourceApiPb.SourceApiActionEventPayloadSchema,
        create(sourceApiPb.SourceApiActionEventPayloadSchema, {
          event: {
            case: "sourceLoaded",
            value: create(sourceApiPb.SourceApiActionSourceLoadedEventSchema, {
              source: create(
                sourceApiPb.SourceApiActionSourceDescriptorSchema,
                {
                  displayName: "GitHub Prod",
                  provider: 99 as WorkflowSourceProvider,
                  sourceId: "source_1",
                  sourceKey: "github-prod",
                }
              ),
            }),
          },
        })
      )
    );
    const decoded = decodeSourceApiActionEventPayload(
      bytes,
      decodeContext("source_loaded")
    );

    expect(decoded.isErr()).toBe(true);
    if (decoded.isOk()) {
      throw new Error("expected invalid provider enum to be rejected");
    }
    expect(decoded.error).toMatchObject({
      _tag: "WorkflowStorageCorruptRowError",
      entity: "source_api_action_event_payload",
      payloadType: "source_loaded",
    });
  });

  it("rejects scalar payload type and protobuf oneof mismatches", () => {
    const bytes = encodeSourceApiActionCommandPayload({
      sourceKey: "github-prod",
      type: "start_describe",
    });

    const error = expectCorruptRow(
      decodeSourceApiActionCommandPayload(
        bytes,
        decodeContext("record_page_fetch_succeeded")
      )
    );

    expect(error).toMatchObject({
      entity: "source_api_action_command_payload",
      payloadType: "record_page_fetch_succeeded",
    });

    const groupedBytes = encodeSourceApiActionCommandPayload({
      attemptNumber: 2,
      detail: "provider timed out",
      failureCode: "request_timed_out",
      kind: "terminal_failure",
      pageIndex: 1,
      type: "record_page_fetch",
    });

    const groupedError = expectCorruptRow(
      decodeSourceApiActionCommandPayload(
        groupedBytes,
        decodeContext("record_page_fetch_succeeded")
      )
    );

    expect(groupedError).toMatchObject({
      entity: "source_api_action_command_payload",
      payloadType: "record_page_fetch_succeeded",
    });
    expect(groupedError.cause).toBeInstanceOf(Error);
    expect(String(groupedError.cause)).toContain(
      "stored scalar payload type 'record_page_fetch_succeeded' does not match protobuf payload type 'record_page_fetch_terminal_failure'"
    );
  });

  it("decodes semantic effect equality without relying on protobuf byte equality", () => {
    const effect: SourceApiActionEffect = {
      organizationId: "org_1",
      sourceKey: "github-prod",
      type: "load_source",
    };
    const canonicalBytes = encodeSourceApiActionEffectPayload(effect);
    const bytesWithUnknownField = Buffer.concat([
      canonicalBytes,
      // Unknown top-level varint field 99. Domain conversion ignores it.
      Buffer.from([0x98, 0x06, 0x7b]),
    ]);

    expect(bytesWithUnknownField.equals(canonicalBytes)).toBe(false);
    expect(
      expectOk(
        decodeSourceApiActionEffectPayload(
          canonicalBytes,
          decodeContext(effect.type)
        )
      )
    ).toEqual(effect);
    expect(
      expectOk(
        decodeSourceApiActionEffectPayload(
          bytesWithUnknownField,
          decodeContext(effect.type)
        )
      )
    ).toEqual(effect);
  });
});
