import { TaggedError } from "better-result";

import type { WorkflowInternalInvariantError } from "../invariant-errors";
import type { WorkflowFamily } from "../kernel";
import type { WorkflowActionRepairAnchor } from "./types";

export class WorkflowStorageReadError extends TaggedError(
  "WorkflowStorageReadError"
)<{
  cause?: unknown;
  family: WorkflowFamily;
  message: string;
  operation: string;
}>() {
  constructor(input: {
    cause?: unknown;
    family: WorkflowFamily;
    operation: string;
  }) {
    super({
      ...(input.cause === undefined ? {} : { cause: input.cause }),
      family: input.family,
      message: `workflow storage read failed during ${input.operation} for ${input.family}`,
      operation: input.operation,
    });
  }
}

export class WorkflowStorageWriteError extends TaggedError(
  "WorkflowStorageWriteError"
)<{
  actionId?: string;
  cause?: unknown;
  family: WorkflowFamily;
  message: string;
  operation: string;
}>() {
  constructor(input: {
    actionId?: string;
    cause?: unknown;
    family: WorkflowFamily;
    operation: string;
  }) {
    super({
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
      ...(input.cause === undefined ? {} : { cause: input.cause }),
      family: input.family,
      message: `workflow storage write failed during ${input.operation} for ${input.family}`,
      operation: input.operation,
    });
  }
}

export class WorkflowStorageContentionError extends TaggedError(
  "WorkflowStorageContentionError"
)<{
  actionId?: string;
  attempts: number;
  family: WorkflowFamily;
  message: string;
}>() {
  constructor(input: {
    actionId?: string;
    attempts: number;
    family: WorkflowFamily;
  }) {
    super({
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
      attempts: input.attempts,
      family: input.family,
      message: `workflow storage could not commit ${input.family} after ${input.attempts} attempts`,
    });
  }
}

export class WorkflowStorageCorruptRowError extends TaggedError(
  "WorkflowStorageCorruptRowError"
)<{
  actionId?: string;
  cause?: unknown;
  commandId?: string;
  entity: string;
  family: WorkflowFamily;
  message: string;
  repairAnchor?: WorkflowActionRepairAnchor | null;
}>() {
  constructor(input: {
    actionId?: string;
    cause?: unknown;
    commandId?: string;
    entity: string;
    family: WorkflowFamily;
    repairAnchor?: WorkflowActionRepairAnchor | null;
  }) {
    super({
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
      ...(input.cause === undefined ? {} : { cause: input.cause }),
      ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
      entity: input.entity,
      family: input.family,
      message: `workflow storage row is corrupt for ${input.family} ${input.entity}`,
      ...(input.repairAnchor === undefined
        ? {}
        : { repairAnchor: input.repairAnchor }),
    });
  }
}

export type WorkflowStorageError =
  | WorkflowStorageReadError
  | WorkflowStorageWriteError
  | WorkflowStorageContentionError
  // Corrupt persisted rows are storage errors, not rejected workflow decisions.
  | WorkflowStorageCorruptRowError
  | WorkflowInternalInvariantError;
