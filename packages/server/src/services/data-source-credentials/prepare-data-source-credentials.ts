import {
  CredentialsSchema,
  dataSources,
  doesSourceProviderMatchCredentials,
  eq,
  isOAuthCredentials,
} from "@onequery/db/server";
import type { Credentials, Database, ProviderType } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";
import { z } from "zod";

import {
  decryptCredentialsObjectResult,
  encryptCredentialsObject,
} from "../crypto/credential-encryption";

export type DataSourceCredentialRecord = {
  id: string;
  name: string;
  provider: ProviderType;
  credentialsEncrypted: string;
  credentialsIv: string;
};

const INVALID_CREDENTIALS_MESSAGE = "Invalid stored credentials";

class PrepareCredentialsError extends TaggedError("PrepareCredentialsError")<{
  reason:
    | "decrypt_failed"
    | "encrypt_failed"
    | "invalid_record"
    | "provider_mismatch"
    | "refresh_failed"
    | "refresh_persist_failed";
  message: string;
  cause?: unknown;
}>() {}

type PrepareCredentialsResult = ResultType<
  {
    credentials: Credentials;
    refreshed: boolean;
  },
  PrepareCredentialsError
>;

type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
};

type GoogleRefreshedToken = {
  accessToken: string;
  expiresAt: number;
};

const DEFAULT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const GoogleTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string(),
});

const GoogleErrorResponseSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

export async function prepareDataSourceCredentials(input: {
  dataSource: DataSourceCredentialRecord;
  db?: Database;
  googleOAuthConfig?: GoogleOAuthConfig;
  masterEncryptionKey: Uint8Array;
}): Promise<PrepareCredentialsResult> {
  const descriptor = describeDataSourceRecord(input.dataSource);

  if (!isValidDataSourceCredentialRecord(input.dataSource)) {
    return Result.err(
      new PrepareCredentialsError({
        message: `${INVALID_CREDENTIALS_MESSAGE} for ${descriptor}`,
        reason: "invalid_record",
      })
    );
  }

  const decrypted = decryptCredentialsObjectResult(
    input.dataSource.credentialsEncrypted,
    input.dataSource.credentialsIv,
    input.masterEncryptionKey,
    CredentialsSchema
  ).mapError(
    (cause) =>
      new PrepareCredentialsError({
        cause,
        message: `${INVALID_CREDENTIALS_MESSAGE} for ${descriptor}`,
        reason: "decrypt_failed",
      })
  );
  if (decrypted.isErr()) {
    return Result.err(decrypted.error);
  }

  if (
    !doesSourceProviderMatchCredentials({
      credentialsType: decrypted.value.type,
      provider: input.dataSource.provider,
    })
  ) {
    return Result.err(
      new PrepareCredentialsError({
        message: `Stored credentials type does not match provider for ${descriptor}`,
        reason: "provider_mismatch",
      })
    );
  }

  if (!isOAuthCredentials(decrypted.value)) {
    return Result.ok({
      credentials: decrypted.value,
      refreshed: false,
    });
  }

  const oauthCredentials = decrypted.value;
  const googleOAuthConfig = input.googleOAuthConfig;
  if (!googleOAuthConfig || !shouldRefreshToken(oauthCredentials.expiresAt)) {
    return Result.ok({
      credentials: oauthCredentials,
      refreshed: false,
    });
  }

  const refreshed = await Result.tryPromise({
    try: () =>
      refreshGoogleToken(googleOAuthConfig, oauthCredentials.refreshToken),
    catch: (cause: unknown) =>
      new PrepareCredentialsError({
        cause,
        message: `Failed to refresh credentials for ${descriptor}`,
        reason: "refresh_failed",
      }),
  });
  if (refreshed.isErr()) {
    return Result.err(refreshed.error);
  }

  const credentials = {
    ...oauthCredentials,
    accessToken: refreshed.value.accessToken,
    expiresAt: refreshed.value.expiresAt,
  };

  const db = input.db;
  if (db) {
    const encrypted = Result.try({
      try: () =>
        encryptCredentialsObject(credentials, input.masterEncryptionKey),
      catch: (cause: unknown) =>
        new PrepareCredentialsError({
          cause,
          message: `Failed to encrypt refreshed credentials for ${descriptor}`,
          reason: "encrypt_failed",
        }),
    });
    if (encrypted.isErr()) {
      return Result.err(encrypted.error);
    }

    const persisted = await Result.tryPromise({
      try: async () => {
        await db
          .update(dataSources)
          .set({
            credentialsEncrypted: encrypted.value.ciphertext,
            credentialsIv: encrypted.value.iv,
          })
          .where(eq(dataSources.id, input.dataSource.id));
      },
      catch: (cause: unknown) =>
        new PrepareCredentialsError({
          cause,
          message: `Failed to persist refreshed credentials for ${descriptor}`,
          reason: "refresh_persist_failed",
        }),
    });
    if (persisted.isErr()) {
      return Result.err(persisted.error);
    }
  }

  return Result.ok({
    credentials,
    refreshed: true,
  });
}

function describeDataSourceRecord(
  dataSource: Pick<DataSourceCredentialRecord, "id">
): string {
  const normalizedId = dataSource.id.trim();
  return normalizedId.length > 0
    ? `data source '${normalizedId}'`
    : "data source";
}

function isValidDataSourceCredentialRecord(
  dataSource: DataSourceCredentialRecord
): boolean {
  return (
    dataSource.id.trim().length > 0 &&
    dataSource.credentialsEncrypted.trim().length > 0 &&
    dataSource.credentialsIv.trim().length > 0
  );
}

function shouldRefreshToken(
  expiresAt: number,
  bufferMs = DEFAULT_REFRESH_BUFFER_MS
): boolean {
  return Date.now() >= expiresAt - bufferMs;
}

async function refreshGoogleToken(
  config: GoogleOAuthConfig,
  refreshToken: string
): Promise<GoogleRefreshedToken> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    const parsed = GoogleErrorResponseSchema.safeParse(await response.json());
    const error = parsed.success
      ? parsed.data
      : { error: "Unknown error", error_description: undefined };
    throw new Error(
      `Google OAuth refresh error: ${error.error}${error.error_description ? ` - ${error.error_description}` : ""}`
    );
  }

  const parsed = GoogleTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Invalid token response from Google OAuth");
  }

  return {
    accessToken: parsed.data.access_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000,
  };
}
