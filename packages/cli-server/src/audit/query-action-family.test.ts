import { describe, expect, it } from "vitest";

import { appendEventMetadata } from "./kernel";
import type { WorkflowActorSnapshot, WorkflowCommandEnvelope } from "./kernel";
import { decideQueryAction, reduceQueryAction } from "./query-action-family";
import type {
  QueryActionCommandPayload,
  QueryActionCommittedEvent,
  QueryActionEvent,
  QueryActionState,
} from "./query-action-family";

const actorSnapshot: WorkflowActorSnapshot = {
  authMode: "browser_session",
  email: "jane@example.com",
  membershipRoles: ["owner"],
  userId: "user_1",
};

const baseObservedAt = new Date("2026-04-20T08:00:00.000Z");

const queryExecutionResponse = {
  columns: [
    {
      logicalType: "number" as const,
      name: "answer",
    },
  ],
  elapsedMs: 18,
  rowCount: 42,
  rows: [["42"]],
  source: {
    displayName: "Warehouse",
    id: "source_1",
    provider: "postgres" as const,
    sourceKey: "warehouse",
    status: "active" as const,
  },
  truncated: false,
};

function buildQueryCommand(
  commandPayload: QueryActionCommandPayload,
  overrides: Partial<
    WorkflowCommandEnvelope<"query_action", QueryActionCommandPayload>
  > = {}
): WorkflowCommandEnvelope<"query_action", QueryActionCommandPayload> {
  return {
    actionId: overrides.actionId ?? null,
    actorSnapshot,
    causedByEventId: overrides.causedByEventId ?? null,
    commandInvocationId:
      overrides.commandInvocationId ??
      `cmd-${commandPayload.type}-${Math.random().toString(36).slice(2)}`,
    commandPayload,
    family: "query_action",
    observedAt: overrides.observedAt ?? baseObservedAt,
    organizationId: overrides.organizationId ?? "org_1",
    requestId: overrides.requestId ?? "req_1",
    surface: overrides.surface ?? "cli",
  };
}

function applyQueryDecision(
  state: QueryActionState | null,
  events: readonly [QueryActionEvent, ...QueryActionEvent[]]
): QueryActionState {
  return events.reduce<QueryActionState | null>(
    (currentState, event, index) => {
      const committedEvent = appendEventMetadata(event, {
        id: `event_${index + 1}_${event.type}`,
        occurredAt: new Date(baseObservedAt.getTime() + index * 1_000),
        sequence:
          currentState === null ? 1 : currentState.lastEventSequence + 1,
      }) satisfies QueryActionCommittedEvent;
      const reduced = reduceQueryAction(currentState, committedEvent);
      expect(reduced.isOk()).toBe(true);
      if (reduced.isErr()) {
        throw reduced.error;
      }
      return reduced.value;
    },
    state
  ) as QueryActionState;
}

function unwrapQueryDecision(result: ReturnType<typeof decideQueryAction>) {
  expect(result.isOk()).toBe(true);
  if (result.isErr()) {
    throw result.error;
  }

  return result.value;
}

describe("query_action family", () => {
  it("executes the documented happy path and keeps usage persistence orthogonal", () => {
    let state: QueryActionState | null = null;

    const startDecision = unwrapQueryDecision(
      decideQueryAction(
        state,
        buildQueryCommand({
          queryText: "select * from customers",
          sourceKey: "warehouse",
          type: "start_execute",
        })
      )
    );
    expect(startDecision.kind).toBe("accepted");
    if (startDecision.kind !== "accepted") {
      return;
    }
    state = applyQueryDecision(state, startDecision.events);
    expect(state.phase).toBe("load_source");

    const sourceLookupDecision = unwrapQueryDecision(
      decideQueryAction(
        state,
        buildQueryCommand(
          {
            kind: "found",
            source: {
              displayName: "Warehouse",
              name: "warehouse",
              organizationId: "org_1",
              provider: "postgres",
              sourceId: "source_1",
              sourceKey: "warehouse",
              sourceStatus: "active",
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
    state = applyQueryDecision(state, sourceLookupDecision.events);

    const validationDecision = unwrapQueryDecision(
      decideQueryAction(
        state,
        buildQueryCommand(
          {
            kind: "accepted",
            truncated: false,
            type: "record_query_validation",
            validatedQuery: "SELECT * FROM customers LIMIT 1000",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );
    expect(validationDecision.kind).toBe("accepted");
    if (validationDecision.kind !== "accepted") {
      return;
    }
    state = applyQueryDecision(state, validationDecision.events);

    const credentialsDecision = unwrapQueryDecision(
      decideQueryAction(
        state,
        buildQueryCommand(
          {
            kind: "loaded",
            type: "record_credentials_load",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );
    expect(credentialsDecision.kind).toBe("accepted");
    if (credentialsDecision.kind !== "accepted") {
      return;
    }
    state = applyQueryDecision(state, credentialsDecision.events);

    const executionDecision = unwrapQueryDecision(
      decideQueryAction(
        state,
        buildQueryCommand(
          {
            kind: "succeeded",
            response: queryExecutionResponse,
            type: "record_query_execution",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );
    expect(executionDecision.kind).toBe("accepted");
    if (executionDecision.kind !== "accepted") {
      return;
    }
    state = applyQueryDecision(state, executionDecision.events);

    const usageDecision = unwrapQueryDecision(
      decideQueryAction(
        state,
        buildQueryCommand(
          {
            detail: "usage sink unavailable",
            kind: "failed",
            type: "record_usage_persistence",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );
    expect(usageDecision.kind).toBe("accepted");
    if (usageDecision.kind !== "accepted") {
      return;
    }
    state = applyQueryDecision(state, usageDecision.events);

    expect(state).toMatchObject({
      failureCode: null,
      outcome: "succeeded",
      phase: "completed",
      queryMode: "execute",
      usageRecordingStatus: "failed",
      validatedQuery: "SELECT * FROM customers LIMIT 1000",
    });
  });

  it("completes validate actions on query_validated without execution stages", () => {
    let state = applyQueryDecision(null, [
      {
        queryMode: "validate",
        queryText: "select 1",
        type: "action_received",
      },
      {
        source: {
          displayName: null,
          name: "warehouse",
          organizationId: "org_1",
          provider: "postgres",
          sourceId: "source_1",
          sourceKey: "warehouse",
          sourceStatus: "active",
        },
        type: "source_loaded",
      },
    ]);

    const decision = unwrapQueryDecision(
      decideQueryAction(
        state,
        buildQueryCommand(
          {
            kind: "accepted",
            truncated: false,
            type: "record_query_validation",
            validatedQuery: "SELECT 1",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );

    expect(decision).toMatchObject({
      kind: "accepted",
      effects: [],
      events: [{ type: "query_validated", validatedQuery: "SELECT 1" }],
    });

    if (decision.kind !== "accepted") {
      return;
    }

    state = applyQueryDecision(state, decision.events);
    expect(state).toMatchObject({
      failureCode: null,
      outcome: "succeeded",
      phase: "completed",
      queryMode: "validate",
    });
  });

  it("completes validation-stage preparation failures as terminal query_preparation_failed actions", () => {
    let state = applyQueryDecision(null, [
      {
        queryMode: "validate",
        queryText: "select 1",
        type: "action_received",
      },
      {
        source: {
          displayName: null,
          name: "warehouse",
          organizationId: "org_1",
          provider: "postgres",
          sourceId: "source_1",
          sourceKey: "warehouse",
          sourceStatus: "active",
        },
        type: "source_loaded",
      },
    ]);

    const decision = unwrapQueryDecision(
      decideQueryAction(
        state,
        buildQueryCommand(
          {
            detail: "sql parser runtime unavailable",
            hint: "retry the request",
            kind: "preparation_failed",
            type: "record_query_validation",
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
          detail: "sql parser runtime unavailable",
          hint: "retry the request",
          type: "query_preparation_failed",
        },
      ],
    });

    if (decision.kind !== "accepted") {
      return;
    }

    state = applyQueryDecision(state, decision.events);
    expect(state).toMatchObject({
      failureCode: "query_preparation_failed",
      outcome: "failed",
      phase: "completed",
      queryMode: "validate",
      usageRecordingStatus: "not_started",
      validatedQuery: null,
    });
  });

  it("rejects stale internal commands with causation_mismatch", () => {
    const state = applyQueryDecision(null, [
      {
        queryMode: "execute",
        queryText: "select 1",
        type: "action_received",
      },
    ]);

    const decision = unwrapQueryDecision(
      decideQueryAction(
        state,
        buildQueryCommand(
          {
            kind: "not_found",
            sourceKey: "warehouse",
            type: "record_source_lookup",
          },
          { actionId: "action_1", causedByEventId: "stale_event" }
        )
      )
    );

    expect(decision).toEqual({
      kind: "rejected",
      rejectCode: "causation_mismatch",
    });
  });

  it("rejects execute-only follow-up commands on validate actions", () => {
    const state = applyQueryDecision(null, [
      {
        queryMode: "validate",
        queryText: "select 1",
        type: "action_received",
      },
      {
        source: {
          displayName: null,
          name: "warehouse",
          organizationId: "org_1",
          provider: "postgres",
          sourceId: "source_1",
          sourceKey: "warehouse",
          sourceStatus: "active",
        },
        type: "source_loaded",
      },
      {
        type: "query_validated",
        validatedQuery: "SELECT 1",
      },
    ]);

    const decision = unwrapQueryDecision(
      decideQueryAction(
        state,
        buildQueryCommand(
          {
            kind: "loaded",
            type: "record_credentials_load",
          },
          { actionId: "action_1", causedByEventId: state.lastEventId }
        )
      )
    );

    expect(decision).toEqual({
      kind: "rejected",
      rejectCode: "invalid_phase",
    });
  });

  it("returns a typed reducer invariant error for malformed event order", () => {
    const event = appendEventMetadata(
      {
        source: {
          displayName: null,
          name: "warehouse",
          organizationId: "org_1",
          provider: "postgres",
          sourceId: "source_1",
          sourceKey: "warehouse",
          sourceStatus: "active",
        },
        type: "source_loaded",
      },
      {
        id: "event_source_loaded",
        occurredAt: baseObservedAt,
        sequence: 1,
      }
    ) satisfies QueryActionCommittedEvent;

    const result = reduceQueryAction(null, event);

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      return;
    }
    expect(result.error).toMatchObject({
      _tag: "WorkflowInternalInvariantError",
      eventType: "source_loaded",
      family: "query_action",
      invariant: "state_required",
      scope: "reducer",
    });
  });

  it("returns a typed decision invariant error for semantically corrupt state", () => {
    const state = {
      ...applyQueryDecision(null, [
        {
          queryMode: "execute",
          queryText: "select 1",
          type: "action_received",
        },
      ]),
      phase: "load_credentials" as const,
      sourceDescriptor: null,
      validatedQuery: "SELECT 1",
    } satisfies QueryActionState;

    const result = decideQueryAction(
      state,
      buildQueryCommand(
        {
          kind: "loaded",
          type: "record_credentials_load",
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
      commandType: "record_credentials_load",
      family: "query_action",
      invariant: "source_descriptor_required",
      phase: "load_credentials",
      scope: "decision",
    });
  });
});
