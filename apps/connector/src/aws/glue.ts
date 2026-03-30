import { GetDatabaseCommand, GlueClient } from "@aws-sdk/client-glue";

import type { ConnectorErrorCode } from "../types";
import { toErrorMessage } from "../utils";

export class GlueAccessError extends Error {
  readonly code: ConnectorErrorCode;

  constructor(input: { code: ConnectorErrorCode; message: string }) {
    super(input.message);
    this.name = "GlueAccessError";
    this.code = input.code;
  }
}

export async function ensureGlueDatabaseAccessible(input: {
  region: string;
  database: string;
}): Promise<void> {
  const client = new GlueClient({ region: input.region });

  try {
    await client.send(
      new GetDatabaseCommand({
        Name: input.database,
      })
    );
  } catch (error) {
    const message = toErrorMessage(error);
    const name = readErrorName(error);

    if (name.includes("AccessDenied") || /access denied/i.test(message)) {
      throw new GlueAccessError({
        code: "AWS_ACCESS_DENIED",
        message,
      });
    }

    if (/expiredtoken|invalidsignature|security token/i.test(message)) {
      throw new GlueAccessError({
        code: "AUTH_FAILED",
        message,
      });
    }

    throw new GlueAccessError({
      code: "UNKNOWN_ERROR",
      message,
    });
  }
}

function readErrorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }

  if (isRecord(error) && typeof error.name === "string") {
    return error.name;
  }

  return "UnknownError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
