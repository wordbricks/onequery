import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

import type { WorkflowFamily } from "../kernel";
import { WorkflowStorageCorruptRowError } from "./errors";

const workflowPayloadValidator = createValidator();

export type WorkflowPayloadCodecContext = {
  actionId?: string;
  commandId?: string;
  entity: string;
  family: WorkflowFamily;
  payloadType?: string;
};

function corruptPayloadError(
  input: WorkflowPayloadCodecContext & { cause: unknown }
) {
  return new WorkflowStorageCorruptRowError({
    ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    cause: input.cause,
    entity: input.entity,
    family: input.family,
    ...(input.payloadType === undefined
      ? {}
      : { payloadType: input.payloadType }),
  });
}

export function encodeWorkflowPayload<Schema extends DescMessage>(
  schema: Schema,
  message: MessageShape<Schema>
): Buffer {
  const validation = workflowPayloadValidator.validate(schema, message);
  if (validation.kind !== "valid") {
    throw validation.error;
  }

  return Buffer.from(toBinary(schema, message));
}

export function decodeWorkflowPayload<Schema extends DescMessage>(
  schema: Schema,
  bytes: Buffer,
  context: WorkflowPayloadCodecContext
): ResultType<MessageShape<Schema>, WorkflowStorageCorruptRowError> {
  let decoded: MessageShape<Schema>;
  try {
    decoded = fromBinary(schema, bytes);
  } catch (cause: unknown) {
    return Result.err(corruptPayloadError({ ...context, cause }));
  }

  const validation = workflowPayloadValidator.validate(schema, decoded);
  if (validation.kind !== "valid") {
    return Result.err(
      corruptPayloadError({
        ...context,
        cause: validation.error,
      })
    );
  }

  return Result.ok(decoded);
}

export function convertWorkflowPayload<T>(
  context: WorkflowPayloadCodecContext,
  convert: () => T
): ResultType<T, WorkflowStorageCorruptRowError> {
  try {
    return Result.ok(convert());
  } catch (cause: unknown) {
    return Result.err(corruptPayloadError({ ...context, cause }));
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled workflow protobuf case: ${String(value)}`);
}
