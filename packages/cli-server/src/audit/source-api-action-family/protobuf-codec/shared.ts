import type { WorkflowPayloadCodecContext } from "../../storage/protobuf-codec";

export type SourceApiPayloadDecodeContext = Omit<
  WorkflowPayloadCodecContext,
  "entity" | "family" | "payloadType"
> & {
  payloadType: string;
};

export function assertMatchingPayloadType(expected: string, actual: string) {
  if (expected !== actual) {
    throw new Error(
      `stored scalar payload type '${expected}' does not match protobuf payload type '${actual}'`
    );
  }
}

export function requireMessage<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined) {
    throw new Error(`missing required protobuf field: ${fieldName}`);
  }

  return value;
}
