import { ulid } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { Result } from "better-result";

import type {
  WorkflowCommandEnvelope,
  WorkflowFamily,
  WorkflowStateBase,
} from "../kernel";
import type { QueryActionCommand } from "../query-action-family";
import type { SourceApiActionCommand } from "../source-api-action-family";
import { sourceApiActionStoreAdapter } from "./adapters";
import { commitWorkflowDecision } from "./commit";
import { WorkflowStorageContentionError } from "./errors";
import type { WorkflowStorageError } from "./errors";
import { storeQueryActionCommandViaJournal } from "./query-action-journal";
import { loadStoredWorkflowDecision, loadWorkflowState } from "./replay";
import type { StoredWorkflowDecision, WorkflowStoreAdapter } from "./types";
import { MAX_STORAGE_COMMIT_ATTEMPTS } from "./types";

export async function storeQueryActionCommand(input: {
  command: QueryActionCommand;
  db: Database;
}) {
  return storeQueryActionCommandViaJournal({
    command: input.command,
    db: input.db,
  });
}

export async function storeSourceApiActionCommand(input: {
  command: SourceApiActionCommand;
  db: Database;
}) {
  return storeWorkflowCommand({
    adapter: sourceApiActionStoreAdapter,
    command: input.command,
    db: input.db,
  });
}

async function storeWorkflowCommand<
  Family extends WorkflowFamily,
  CommandPayload extends { type: string },
  State extends WorkflowStateBase<string, string>,
  Event extends { type: string },
  Effect extends { type: string },
  RejectCode extends string,
>(input: {
  adapter: WorkflowStoreAdapter<
    Family,
    CommandPayload,
    State,
    Event,
    Effect,
    RejectCode
  >;
  command: WorkflowCommandEnvelope<Family, CommandPayload>;
  db: Database;
}): Promise<
  Result<
    StoredWorkflowDecision<Family, Event, RejectCode>,
    WorkflowStorageError
  >
> {
  const { adapter, command, db } = input;

  for (let attempt = 1; attempt <= MAX_STORAGE_COMMIT_ATTEMPTS; attempt += 1) {
    const storedDecision = await loadStoredWorkflowDecision({
      adapter,
      commandInvocationId: command.commandInvocationId,
      db,
    });

    if (storedDecision.isErr()) {
      return Result.err(storedDecision.error);
    }

    if (storedDecision.value !== null) {
      return Result.ok({
        ...storedDecision.value,
        idempotency: "replayed",
      });
    }

    const loadedState = await loadWorkflowState({
      actionId: command.actionId,
      adapter,
      db,
    });

    if (loadedState.isErr()) {
      return Result.err(loadedState.error);
    }

    const currentState = loadedState.value;
    const decision = adapter.decide(currentState, command);
    if (decision.isErr()) {
      return Result.err(decision.error);
    }

    const actionId =
      decision.value.kind === "accepted"
        ? (command.actionId ?? ulid())
        : command.actionId;

    const commitResult = await commitWorkflowDecision({
      actionId,
      adapter,
      command,
      currentState,
      db,
      decision: decision.value,
    });

    if (commitResult.isErr()) {
      return Result.err(commitResult.error);
    }

    if (commitResult.value.kind === "race_lost") {
      continue;
    }

    return Result.ok({
      ...commitResult.value,
      idempotency: "fresh",
    });
  }

  return Result.err(
    new WorkflowStorageContentionError({
      ...(command.actionId === null ? {} : { actionId: command.actionId }),
      attempts: MAX_STORAGE_COMMIT_ATTEMPTS,
      family: adapter.family,
    })
  );
}
