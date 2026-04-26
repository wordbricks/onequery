import type { ProviderType } from "@onequery/db/server";

type SourceApiErrorOptions = {
  cause?: unknown;
};

export abstract class SourceApiError extends Error {
  constructor(message: string, options?: SourceApiErrorOptions) {
    super(message, toErrorOptions(options));
    this.name = new.target.name;
  }
}

export abstract class SourceApiRequestError extends SourceApiError {}

export class SourceApiInvalidRequestError extends SourceApiRequestError {}

export class SourceApiAdapterNotRegisteredError extends SourceApiError {
  readonly provider: ProviderType;

  constructor(provider: ProviderType) {
    super(`No source API adapter is registered for provider "${provider}"`);
    this.provider = provider;
  }
}

export class SourceApiPermissionDeniedError extends SourceApiError {
  readonly operation: string;
  readonly userId: string;

  constructor(input: { operation: string; userId: string }) {
    super(
      `Actor "${input.userId}" is not allowed to execute source API operation "${input.operation}"`
    );
    this.operation = input.operation;
    this.userId = input.userId;
  }
}

export class SourceApiExpiredError extends SourceApiError {}

export class SourceApiInvalidatedError extends SourceApiError {}

export class SourceApiDescriptorVersionMismatchError extends SourceApiInvalidatedError {
  readonly expectedDescriptorVersion: string;
  readonly receivedDescriptorVersion: string;

  constructor(input: {
    expectedDescriptorVersion: string;
    receivedDescriptorVersion: string;
  }) {
    super(
      `descriptor_version mismatch: expected "${input.expectedDescriptorVersion}", received "${input.receivedDescriptorVersion}"`
    );
    this.expectedDescriptorVersion = input.expectedDescriptorVersion;
    this.receivedDescriptorVersion = input.receivedDescriptorVersion;
  }
}

export class SourceApiTimeoutError extends SourceApiError {}

export class SourceApiRegistryConfigurationError extends SourceApiError {
  readonly provider: ProviderType;

  constructor(provider: ProviderType) {
    super(
      `Duplicate source API adapter registration for provider "${provider}"`
    );
    this.provider = provider;
  }
}

export class SourceApiUnsupportedOperationError extends SourceApiInvalidRequestError {
  readonly operationName: string;

  constructor(operationName: string) {
    super(`Unsupported source API operation: ${operationName}`);
    this.operationName = operationName;
  }
}

export function readSourceApiErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function toErrorOptions(
  options: SourceApiErrorOptions | undefined
): ErrorOptions | undefined {
  if (options?.cause instanceof Error) {
    return { cause: options.cause };
  }

  return undefined;
}
