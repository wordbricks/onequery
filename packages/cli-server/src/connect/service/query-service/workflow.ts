import { Result } from "better-result";

import {
  runCliQueryExecutionWorkflow,
  runCliQueryValidationWorkflow,
} from "../../../query/workflow";
import type {
  CliQueryExecutionWorkflowResult,
  CliQueryValidationWorkflowResult,
} from "../../../query/workflow";
import type { CliServiceResult } from "../result";
import type { CliQueryWorkflowObserverController } from "./action-trail";

type QueryWorkflowObserverInput = {
  observer: CliQueryWorkflowObserverController;
};

export async function runCliQueryExecutionWorkflowResult(
  input: Omit<
    Parameters<typeof runCliQueryExecutionWorkflow>[0],
    "observeEvent" | "observeEventFailure"
  > &
    QueryWorkflowObserverInput
): Promise<CliServiceResult<CliQueryExecutionWorkflowResult>> {
  const { observer, ...workflowInput } = input;

  const result = await runCliQueryExecutionWorkflow({
    ...workflowInput,
    ...observer.observer,
  });

  return finalizeCliQueryWorkflowResult(result, observer);
}

export async function runCliQueryValidationWorkflowResult(
  input: Omit<
    Parameters<typeof runCliQueryValidationWorkflow>[0],
    "observeEvent" | "observeEventFailure"
  > &
    QueryWorkflowObserverInput
): Promise<CliServiceResult<CliQueryValidationWorkflowResult>> {
  const { observer, ...workflowInput } = input;

  const result = await runCliQueryValidationWorkflow({
    ...workflowInput,
    ...observer.observer,
  });

  return finalizeCliQueryWorkflowResult(result, observer);
}

function finalizeCliQueryWorkflowResult<T>(
  result: T,
  observer: CliQueryWorkflowObserverController
) {
  const failure = observer.getFailure();
  if (failure) {
    return Result.err(failure);
  }

  return Result.ok(result);
}
