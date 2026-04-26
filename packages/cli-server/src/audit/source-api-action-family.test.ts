import { describe, expect, it } from "vitest";

import { appendEventMetadata } from "./kernel";
import type { WorkflowActorSnapshot, WorkflowCommandEnvelope } from "./kernel";
import {
  decideSourceApiAction,
  reduceSourceApiAction,
} from "./source-api-action-family";
import type {
  SourceApiActionCommandPayload,
  SourceApiActionCommittedEvent,
  SourceApiActionEvent,
  SourceApiActionState,
} from "./source-api-action-family";

const actorSnapshot: WorkflowActorSnapshot = {
  authMode: "browser_session",
  email: "jane@example.com",
  membershipRoles: ["owner"],
  userId: "user_1",
};

const baseObservedAt = new Date("2026-04-20T09:00:00.000Z");

const resolvedDescriptor = {
  descriptorVersion: "v1",
  examples: [],
  notes: [],
  operations: [
    {
      description: "Fetch data",
      examples: [],
      fieldPolicy: {
        acceptsInput: false,
        allowsRawFields: false,
        allowsTypedFields: false,
        inputMode: "none" as const,
        mergePatches: false,
        supportsArrayPaths: false,
        supportsNestedPaths: false,
      },
      headerPolicy: {
        allowedRequestHeaders: [],
        allowedResponseHeaders: [],
      },
      kind: "http_request" as const,
      methodPolicy: {
        allowedMethods: ["GET"],
        defaultMethod: "GET",
      },
      name: "fetch",
      notes: [],
      paginationPolicy: "continuation_token" as const,
      selectorKind: "path" as const,
      selectorLabel: "path",
      summary: "Fetch data",
    },
  ],
  source: {
    displayName: "GitHub",
    provider: "github" as const,
    sourceKey: "github",
  },
} as const;

const firstPageExecutionResult = {
  body: {
    kind: "json" as const,
    value: {
      page: 1,
    },
  },
  contentType: "application/json",
  headers: [],
  nextContinuationState: {
    cursor: "page-2",
  },
  operation: "fetch",
  selector: "customers",
  source: resolvedDescriptor.source,
  status: 200,
} as const;

const secondPageExecutionResult = {
  body: {
    kind: "json" as const,
    value: {
      page: 2,
    },
  },
  contentType: "application/json",
  headers: [],
  operation: "fetch",
  selector: "customers?page=2",
  source: resolvedDescriptor.source,
  status: 200,
} as const;

function buildSourceApiCommand(
  commandPayload: SourceApiActionCommandPayload,
  overrides: Partial<
    WorkflowCommandEnvelope<"source_api_action", SourceApiActionCommandPayload>
  > = {}
): WorkflowCommandEnvelope<"source_api_action", SourceApiActionCommandPayload> {
  return {
    actionId: overrides.actionId ?? null,
    actorSnapshot,
    causedByEventId: overrides.causedByEventId ?? null,
    commandInvocationId:
      overrides.commandInvocationId ??
      `cmd-${commandPayload.type}-${Math.random().toString(36).slice(2)}`,
    commandPayload,
    family: "source_api_action",
    observedAt: overrides.observedAt ?? baseObservedAt,
    organizationId: overrides.organizationId ?? "org_1",
    requestId: overrides.requestId ?? "req_1",
    surface: overrides.surface ?? "cli",
  };
}

function applySourceApiDecision(
  state: SourceApiActionState | null,
  events: readonly [SourceApiActionEvent, ...SourceApiActionEvent[]]
): SourceApiActionState {
  return events.reduce<SourceApiActionState | null>(
    (currentState, event, index) => {
      const committedEvent = appendEventMetadata(event, {
        id: `event_${index + 1}_${event.type}`,
        occurredAt: new Date(baseObservedAt.getTime() + index * 1_000),
        sequence:
          currentState === null ? 1 : currentState.lastEventSequence + 1,
      }) satisfies SourceApiActionCommittedEvent;
      const reduced = reduceSourceApiAction(currentState, committedEvent);
      expect(reduced.isOk()).toBe(true);
      if (reduced.isErr()) {
        throw reduced.error;
      }
      return reduced.value;
    },
    state
  ) as SourceApiActionState;
}

function unwrapSourceApiDecision(
  result: ReturnType<typeof decideSourceApiAction>
) {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

describe("source_api_action family", () => {
  it("models execute plus resume on the same action", () => {
    let state: SourceApiActionState | null = null;

    const startDecision = unwrapSourceApiDecision(
      decideSourceApiAction(
        state,
        buildSourceApiCommand({
          invokeMode: "execute",
          requestDescriptor: {
            descriptorVersion: null,
            kind: null,
            method: null,
            operation: "fetch",
            paginationPolicy: null,
            selector: "customers",
          },
          sourceKey: "github",
          type: "start_invoke",
        })
      )
    );
    expect(startDecision.kind).toBe("accepted");
    if (startDecision.kind !== "accepted") {
      return;
    }
    state = applySourceApiDecision(state, startDecision.events);

    const sourceLookupDecision = unwrapSourceApiDecision(
      decideSourceApiAction(
        state,
        buildSourceApiCommand(
          {
            kind: "found",
            source: {
              displayName: "GitHub",
              provider: "github",
              sourceId: "source_1",
              sourceKey: "github",
            },
            type: "record_source_lookup",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );
    expect(sourceLookupDecision.kind).toBe("accepted");
    if (sourceLookupDecision.kind !== "accepted") {
      return;
    }
    state = applySourceApiDecision(state, sourceLookupDecision.events);

    const descriptorDecision = unwrapSourceApiDecision(
      decideSourceApiAction(
        state,
        buildSourceApiCommand(
          {
            descriptor: resolvedDescriptor,
            kind: "resolved",
            requestDescriptor: {
              descriptorVersion: "v1",
              kind: "http_request",
              method: "GET",
              operation: "fetch",
              paginationPolicy: "continuation_token",
              selector: "customers",
            },
            type: "record_descriptor_resolution",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );
    expect(descriptorDecision.kind).toBe("accepted");
    if (descriptorDecision.kind !== "accepted") {
      return;
    }
    state = applySourceApiDecision(state, descriptorDecision.events);

    const preparedDecision = unwrapSourceApiDecision(
      decideSourceApiAction(
        state,
        buildSourceApiCommand(
          {
            kind: "prepared",
            preparedRequestFingerprint: "prepared_v1",
            type: "record_request_preparation",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );
    expect(preparedDecision.kind).toBe("accepted");
    if (preparedDecision.kind !== "accepted") {
      return;
    }
    state = applySourceApiDecision(state, preparedDecision.events);

    const firstPageDecision = unwrapSourceApiDecision(
      decideSourceApiAction(
        state,
        buildSourceApiCommand(
          {
            attemptNumber: 1,
            contentType: "application/json",
            executionResult: {
              ...firstPageExecutionResult,
              body: {
                kind: "json",
                value: {
                  page: 1,
                },
              },
            },
            hasContinuation: true,
            httpStatus: 200,
            kind: "succeeded",
            pageIndex: 0,
            responseBytes: 120,
            type: "record_page_fetch",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );
    expect(firstPageDecision.kind).toBe("accepted");
    if (firstPageDecision.kind !== "accepted") {
      return;
    }
    state = applySourceApiDecision(state, firstPageDecision.events);
    expect(state.phase).toBe("await_resume");

    const resumeDecision = unwrapSourceApiDecision(
      decideSourceApiAction(
        state,
        buildSourceApiCommand(
          {
            preparedRequestFingerprint: "prepared_v1",
            resumeFromEventId: state.lastEventId,
            type: "resume_invoke",
          },
          { actionId: "action_1" }
        )
      )
    );
    expect(resumeDecision.kind).toBe("accepted");
    if (resumeDecision.kind !== "accepted") {
      return;
    }
    state = applySourceApiDecision(state, resumeDecision.events);

    const secondPageDecision = unwrapSourceApiDecision(
      decideSourceApiAction(
        state,
        buildSourceApiCommand(
          {
            attemptNumber: 2,
            contentType: "application/json",
            executionResult: {
              ...secondPageExecutionResult,
              body: {
                kind: "json",
                value: {
                  page: 2,
                },
              },
            },
            hasContinuation: false,
            httpStatus: 200,
            kind: "succeeded",
            pageIndex: 1,
            responseBytes: 90,
            type: "record_page_fetch",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );
    expect(secondPageDecision.kind).toBe("accepted");
    if (secondPageDecision.kind !== "accepted") {
      return;
    }
    state = applySourceApiDecision(state, secondPageDecision.events);

    expect(state).toMatchObject({
      attemptNumber: 2,
      failureCode: null,
      outcome: "succeeded",
      phase: "completed",
      preparedRequestFingerprint: "prepared_v1",
    });
  });

  it("supports preview-only invoke without execute_page", () => {
    const state = applySourceApiDecision(null, [
      {
        invokeMode: "preview_only",
        requestDescriptor: {
          descriptorVersion: "v1",
          kind: "http_request",
          method: "GET",
          operation: "fetch",
          paginationPolicy: "none",
          selector: "customers",
        },
        requestKind: "invoke",
        type: "action_received",
      },
      {
        source: {
          displayName: "GitHub",
          provider: "github",
          sourceId: "source_1",
          sourceKey: "github",
        },
        type: "source_loaded",
      },
      {
        requestDescriptor: {
          descriptorVersion: "v1",
          kind: "http_request",
          method: "GET",
          operation: "fetch",
          paginationPolicy: "none",
          selector: "customers",
        },
        type: "descriptor_resolved",
      },
    ]);

    const decision = unwrapSourceApiDecision(
      decideSourceApiAction(
        state,
        buildSourceApiCommand(
          {
            kind: "prepared",
            preparedRequestFingerprint: "prepared_preview",
            type: "record_request_preparation",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );

    expect(decision).toMatchObject({
      kind: "accepted",
      effects: [],
      events: [
        {
          preparedRequestFingerprint: "prepared_preview",
          type: "request_prepared",
        },
      ],
    });
  });

  it("rejects stale resume commands", () => {
    const state = applySourceApiDecision(null, [
      {
        invokeMode: "execute",
        requestDescriptor: {
          descriptorVersion: "v1",
          kind: "http_request",
          method: "GET",
          operation: "fetch",
          paginationPolicy: "continuation_token",
          selector: "customers",
        },
        requestKind: "invoke",
        type: "action_received",
      },
      {
        source: {
          displayName: "GitHub",
          provider: "github",
          sourceId: "source_1",
          sourceKey: "github",
        },
        type: "source_loaded",
      },
      {
        requestDescriptor: {
          descriptorVersion: "v1",
          kind: "http_request",
          method: "GET",
          operation: "fetch",
          paginationPolicy: "continuation_token",
          selector: "customers",
        },
        type: "descriptor_resolved",
      },
      {
        preparedRequestFingerprint: "prepared_v1",
        type: "request_prepared",
      },
      {
        attemptNumber: 1,
        contentType: "application/json",
        hasContinuation: true,
        httpStatus: 200,
        pageIndex: 0,
        responseBytes: 100,
        type: "page_fetch_succeeded",
      },
    ]);

    const decision = unwrapSourceApiDecision(
      decideSourceApiAction(
        state,
        buildSourceApiCommand(
          {
            preparedRequestFingerprint: "prepared_v1",
            resumeFromEventId: "stale_event",
            type: "resume_invoke",
          },
          { actionId: "action_1" }
        )
      )
    );

    expect(decision).toEqual({
      kind: "rejected",
      rejectCode: "causation_mismatch",
    });
  });

  it("moves terminal page fetch failures into completed failed", () => {
    let state = applySourceApiDecision(null, [
      {
        invokeMode: "execute",
        requestDescriptor: {
          descriptorVersion: "v1",
          kind: "http_request",
          method: "GET",
          operation: "fetch",
          paginationPolicy: "continuation_token",
          selector: "customers",
        },
        requestKind: "invoke",
        type: "action_received",
      },
      {
        source: {
          displayName: "GitHub",
          provider: "github",
          sourceId: "source_1",
          sourceKey: "github",
        },
        type: "source_loaded",
      },
      {
        requestDescriptor: {
          descriptorVersion: "v1",
          kind: "http_request",
          method: "GET",
          operation: "fetch",
          paginationPolicy: "continuation_token",
          selector: "customers",
        },
        type: "descriptor_resolved",
      },
      {
        preparedRequestFingerprint: "prepared_v1",
        type: "request_prepared",
      },
      {
        attemptNumber: 1,
        type: "resume_requested",
      },
    ]);

    const decision = unwrapSourceApiDecision(
      decideSourceApiAction(
        state,
        buildSourceApiCommand(
          {
            attemptNumber: 1,
            detail: "upstream timeout",
            failureCode: "request_timed_out",
            kind: "terminal_failure",
            pageIndex: 2,
            problemKey: "SOURCE_API_EXECUTION_TIMED_OUT",
            type: "record_page_fetch",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );

    expect(decision.kind).toBe("accepted");
    if (decision.kind !== "accepted") {
      return;
    }

    state = applySourceApiDecision(state, decision.events);
    expect(state).toMatchObject({
      failureCode: "request_timed_out",
      outcome: "failed",
      pageProgress: null,
      phase: "completed",
    });
  });

  it("returns a typed reducer invariant error for malformed event order", () => {
    const event = appendEventMetadata(
      {
        source: {
          displayName: "GitHub",
          provider: "github",
          sourceId: "source_1",
          sourceKey: "github",
        },
        type: "source_loaded",
      },
      {
        id: "event_source_loaded",
        occurredAt: baseObservedAt,
        sequence: 1,
      }
    ) satisfies SourceApiActionCommittedEvent;

    const result = reduceSourceApiAction(null, event);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }
    expect(result.error).toMatchObject({
      _tag: "WorkflowInternalInvariantError",
      eventType: "source_loaded",
      family: "source_api_action",
      invariant: "state_required",
      scope: "reducer",
    });
  });

  it("returns a typed decision invariant error for semantically corrupt state", () => {
    const state = {
      ...applySourceApiDecision(null, [
        {
          invokeMode: "execute",
          requestDescriptor: {
            descriptorVersion: "v1",
            kind: "http_request",
            method: "GET",
            operation: "fetch",
            paginationPolicy: "none",
            selector: "customers",
          },
          requestKind: "invoke",
          type: "action_received",
        },
        {
          source: {
            displayName: "GitHub",
            provider: "github",
            sourceId: "source_1",
            sourceKey: "github",
          },
          type: "source_loaded",
        },
        {
          requestDescriptor: {
            descriptorVersion: "v1",
            kind: "http_request",
            method: "GET",
            operation: "fetch",
            paginationPolicy: "none",
            selector: "customers",
          },
          type: "descriptor_resolved",
        },
      ]),
      requestDescriptor: null,
    } satisfies SourceApiActionState;

    const result = decideSourceApiAction(
      state,
      buildSourceApiCommand(
        {
          kind: "prepared",
          preparedRequestFingerprint: "prepared_v1",
          type: "record_request_preparation",
        },
        { actionId: "action_1", causedByEventId: state.lastEventId }
      )
    );

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }
    expect(result.error).toMatchObject({
      _tag: "WorkflowInternalInvariantError",
      commandType: "record_request_preparation",
      family: "source_api_action",
      invariant: "request_descriptor_required",
      phase: "prepare_request",
      scope: "decision",
    });
  });
});
