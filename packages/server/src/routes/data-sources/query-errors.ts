type QueryErrorBody = {
  error: string;
};

export function createQueryError(message: string): QueryErrorBody {
  return { error: message };
}

export function createPrefixedQueryError(
  prefix: string,
  error: unknown
): QueryErrorBody {
  return createQueryError(`${prefix}: ${readQueryErrorMessage(error)}`);
}

export function createCredentialTypeQueryError(
  providerLabel: string
): QueryErrorBody {
  return createQueryError(`Data source credentials are not ${providerLabel}`);
}

function readQueryErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
