import { CredentialsSchema } from "@onequery/db/server";
import type { Credentials, ProviderType } from "@onequery/db/server";
import { Result, TaggedError } from "better-result";
import type { Result as ResultType } from "better-result";

import { decryptCredentialsObject } from "../crypto/credential-encryption";

export type DataSourceCredentialRecord = {
  id: string;
  name: string;
  provider: ProviderType;
  credentialsEncrypted: string;
  credentialsIv: string;
};

const INVALID_CREDENTIALS_MESSAGE = "Invalid stored credentials";

class PrepareCredentialsError extends TaggedError("PrepareCredentialsError")<{
  reason: "decrypt_failed" | "invalid_record" | "provider_mismatch";
  message: string;
  cause?: unknown;
}>() {}

function doesProviderMatchCredentials(input: {
  provider: ProviderType;
  credentialsType: Credentials["type"];
}): boolean {
  if (input.provider === input.credentialsType) {
    return true;
  }

  return input.provider === "supabase" && input.credentialsType === "postgres";
}

type PrepareCredentialsResult = ResultType<
  {
    credentials: Credentials;
    refreshed: boolean;
  },
  PrepareCredentialsError
>;

export async function prepareDataSourceCredentials(input: {
  dataSource: DataSourceCredentialRecord;
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

  const decrypted = Result.try({
    try: () =>
      decryptCredentialsObject(
        input.dataSource.credentialsEncrypted,
        input.dataSource.credentialsIv,
        input.masterEncryptionKey,
        CredentialsSchema
      ),
    catch: (cause) =>
      new PrepareCredentialsError({
        cause,
        message: `${INVALID_CREDENTIALS_MESSAGE} for ${descriptor}`,
        reason: "decrypt_failed",
      }),
  });
  if (decrypted.isErr()) {
    return Result.err(decrypted.error);
  }

  if (
    !doesProviderMatchCredentials({
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

  return Result.ok({
    credentials: decrypted.value,
    refreshed: false,
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
