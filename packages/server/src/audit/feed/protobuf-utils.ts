export function assertNever(value: never): never {
  throw new Error(`Unexpected workflow payload variant: ${String(value)}`);
}

export function requireProtoMessage<T>(
  value: T | undefined,
  fieldName: string
): T {
  if (value === undefined) {
    throw new Error(`workflow protobuf field ${fieldName} is missing`);
  }

  return value;
}
