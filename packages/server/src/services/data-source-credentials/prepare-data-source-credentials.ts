import { CredentialsSchema } from "@onequery/db/server";
import type { Credentials, ProviderType } from "@onequery/db/server";

import {
  decryptCredentialsObject,
  deriveKeyFromBase64,
} from "../crypto/credential-encryption";

export type DataSourceCredentialRecord = {
  id: string;
  name: string;
  provider: ProviderType;
  credentialsEncrypted: string;
  credentialsIv: string;
};

const INVALID_CREDENTIALS_MESSAGE = "Invalid stored credentials";

function doesProviderMatchCredentials(input: {
  provider: ProviderType;
  credentialsType: Credentials["type"];
}): boolean {
  if (input.provider === input.credentialsType) {
    return true;
  }

  return input.provider === "supabase" && input.credentialsType === "postgres";
}

type PrepareCredentialsResult =
  | {
      ok: true;
      value: {
        credentials: Credentials;
        refreshed: boolean;
      };
    }
  | {
      ok: false;
      error: string;
    };

export async function prepareDataSourceCredentials(input: {
  dataSource: DataSourceCredentialRecord;
  masterEncryptionKey: string;
}): Promise<PrepareCredentialsResult> {
  const descriptor = describeDataSourceRecord(input.dataSource);

  try {
    if (!isValidDataSourceCredentialRecord(input.dataSource)) {
      return {
        error: `${INVALID_CREDENTIALS_MESSAGE} for ${descriptor}`,
        ok: false,
      };
    }

    const masterKey = deriveKeyFromBase64(input.masterEncryptionKey);
    let decrypted: Credentials;
    try {
      decrypted = decryptCredentialsObject(
        input.dataSource.credentialsEncrypted,
        input.dataSource.credentialsIv,
        masterKey,
        CredentialsSchema
      );
    } catch {
      return {
        error: `${INVALID_CREDENTIALS_MESSAGE} for ${descriptor}`,
        ok: false,
      };
    }

    if (
      !doesProviderMatchCredentials({
        credentialsType: decrypted.type,
        provider: input.dataSource.provider,
      })
    ) {
      return {
        error: `Stored credentials type does not match provider for ${descriptor}`,
        ok: false,
      };
    }

    return {
      ok: true,
      value: {
        credentials: decrypted,
        refreshed: false,
      },
    };
  } catch (error) {
    return {
      error: `Failed to prepare credentials for ${descriptor}: ${toErrorMessage(
        error
      )}`,
      ok: false,
    };
  }
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
