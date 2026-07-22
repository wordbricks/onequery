import { CredentialsSchema } from "@onequery/db";
import type { Credentials } from "@onequery/db";
import { and, dataSources, eq } from "@onequery/db/server";
import type { Database, ProviderType } from "@onequery/db/server";
import { safeParseSourceProviderCredentials } from "@onequery/db/source-providers";
import type { SourceProviderCredentialsParseError } from "@onequery/db/source-providers";
import {
  decryptCredentialsObjectResult,
  encryptCredentialsObject,
} from "@onequery/server/services/crypto/credential-encryption";
import type { EncryptedCredentialsDecodeError } from "@onequery/server/services/crypto/credential-encryption";
import {
  serializeDataSourceTestOutcome,
  testDataSource,
} from "@onequery/server/services/data-source-tester";
import type { Result as ResultType } from "better-result";

import type {
  CliQuerySourceRecord,
  CliSourceRecord,
} from "../domain/workflows";
import { mergeSourceCredentialPatch } from "./credential-patch";
import { runCliLoadSourceEffect } from "./effects";
import { createCliSourceRecord } from "./model";

type CliSourceUpdateDependencies = {
  decryptCredentials(input: {
    credentialsEncrypted: string;
    credentialsIv: string;
    masterEncryptionKey: Uint8Array;
  }): ResultType<Credentials, EncryptedCredentialsDecodeError>;
  encryptCredentials(
    credentials: Credentials,
    masterEncryptionKey: Uint8Array
  ): ReturnType<typeof encryptCredentialsObject>;
  loadSource: typeof runCliLoadSourceEffect;
  testCredentials(input: {
    credentials: Credentials;
    db: Database;
    organizationId: string;
  }): Promise<ReturnType<typeof serializeDataSourceTestOutcome>>;
};

type CliSourceDeleteDependencies = Pick<
  CliSourceUpdateDependencies,
  "loadSource"
>;

const defaultUpdateDependencies: CliSourceUpdateDependencies = {
  decryptCredentials: (input) =>
    decryptCredentialsObjectResult(
      input.credentialsEncrypted,
      input.credentialsIv,
      input.masterEncryptionKey,
      CredentialsSchema
    ),
  encryptCredentials: encryptCredentialsObject,
  loadSource: runCliLoadSourceEffect,
  testCredentials: async (input) =>
    serializeDataSourceTestOutcome(
      await testDataSource(input.credentials, {
        db: input.db,
        organizationId: input.organizationId,
      })
    ),
};

const defaultDeleteDependencies: CliSourceDeleteDependencies = {
  loadSource: runCliLoadSourceEffect,
};

export type CliSourceMutationTest =
  | {
      kind: "supported";
      success: true;
      message: string;
      latencyMs: number;
    }
  | {
      kind: "unsupported";
      reason: "oauth" | "not_implemented";
      message: string;
    };

export type CliSourceUpdateResult =
  | {
      kind: "updated";
      source: CliSourceRecord;
      test: CliSourceMutationTest;
    }
  | { kind: "not_found" }
  | { kind: "invalid_credentials"; detail: string }
  | { kind: "connection_test_failed"; detail: string; message: string };

export type CliSourceDeleteResult =
  | { kind: "deleted"; source: CliSourceRecord }
  | { kind: "not_found" };

export async function updateCliSource(
  input: {
    db: Database;
    organizationId: string;
    sourceKey: string;
    sourceProvider?: ProviderType;
    credentialsPatch: unknown;
    masterEncryptionKey: Uint8Array;
  },
  dependencies = defaultUpdateDependencies
): Promise<CliSourceUpdateResult> {
  const loaded = await loadSource(input, dependencies);
  if (!loaded) {
    return { kind: "not_found" };
  }

  const currentCredentials = dependencies.decryptCredentials({
    credentialsEncrypted: loaded.credentialsEncrypted,
    credentialsIv: loaded.credentialsIv,
    masterEncryptionKey: input.masterEncryptionKey,
  });
  if (currentCredentials.isErr()) {
    return {
      detail: currentCredentials.error.message,
      kind: "invalid_credentials",
    };
  }

  const merged = mergeSourceCredentialPatch(
    currentCredentials.value,
    input.credentialsPatch
  );
  if (!merged.ok) {
    return { detail: merged.detail, kind: "invalid_credentials" };
  }

  const parsed = safeParseSourceProviderCredentials({
    credentials: merged.value,
    provider: loaded.provider,
  });
  if (!parsed.success) {
    return {
      detail: sourceCredentialsErrorDetail(parsed.error),
      kind: "invalid_credentials",
    };
  }

  const unsupportedPatchFields = Object.keys(
    input.credentialsPatch as Record<string, unknown>
  ).filter((field) => !(field in parsed.data.credentials));
  if (unsupportedPatchFields.length > 0) {
    return {
      detail: `unsupported credential field${unsupportedPatchFields.length === 1 ? "" : "s"}: ${unsupportedPatchFields.join(", ")}`,
      kind: "invalid_credentials",
    };
  }

  const test = await dependencies.testCredentials({
    credentials: parsed.data.credentials,
    db: input.db,
    organizationId: input.organizationId,
  });
  if (test.kind === "supported" && !test.result.success) {
    return {
      detail: test.result.error,
      kind: "connection_test_failed",
      message: test.result.message,
    };
  }

  const encrypted = dependencies.encryptCredentials(
    parsed.data.credentials,
    input.masterEncryptionKey
  );
  const now = new Date();
  const [updated] = await input.db
    .update(dataSources)
    .set({
      credentialsEncrypted: encrypted.ciphertext,
      credentialsIv: encrypted.iv,
      errorMessage: null,
      lastUsedAt: now,
      status: "active",
      updatedAt: now,
    })
    .where(
      and(
        eq(dataSources.id, loaded.id),
        eq(dataSources.organizationId, input.organizationId)
      )
    )
    .returning({
      id: dataSources.id,
      name: dataSources.name,
      provider: dataSources.provider,
      status: dataSources.status,
    });
  const source = updated ? createCliSourceRecord(updated) : null;
  if (!source) {
    return { kind: "not_found" };
  }

  return {
    kind: "updated",
    source,
    test:
      test.kind === "supported"
        ? {
            kind: "supported",
            latencyMs: test.result.latencyMs,
            message: test.result.message,
            success: true,
          }
        : test,
  };
}

export async function deleteCliSource(
  input: {
    db: Database;
    organizationId: string;
    sourceKey: string;
    sourceProvider?: ProviderType;
  },
  dependencies = defaultDeleteDependencies
): Promise<CliSourceDeleteResult> {
  const loaded = await loadSource(input, dependencies);
  if (!loaded) {
    return { kind: "not_found" };
  }

  const source = createCliSourceRecord(loaded);
  if (!source) {
    return { kind: "not_found" };
  }
  const deleted = await input.db
    .delete(dataSources)
    .where(
      and(
        eq(dataSources.id, loaded.id),
        eq(dataSources.organizationId, input.organizationId)
      )
    )
    .returning({ id: dataSources.id });

  return deleted.length > 0
    ? { kind: "deleted", source }
    : { kind: "not_found" };
}

async function loadSource(
  input: {
    db: Database;
    organizationId: string;
    sourceKey: string;
    sourceProvider?: ProviderType;
  },
  dependencies: CliSourceDeleteDependencies
): Promise<CliQuerySourceRecord | null> {
  const loaded = await dependencies.loadSource({
    db: input.db,
    effect: {
      kind: "load_source",
      organizationId: input.organizationId,
      sourceKey: input.sourceKey,
      sourceProvider: input.sourceProvider,
    },
  });
  return loaded.kind === "found" ? loaded.source : null;
}

function sourceCredentialsErrorDetail(
  error: SourceProviderCredentialsParseError
): string {
  switch (error.code) {
    case "invalid_credentials":
      return error.error.issues[0]?.message ?? "invalid source credentials";
    case "provider_credentials_mismatch":
      return `credentials type "${error.credentialsType}" does not match provider "${error.provider}"`;
    case "unsupported_provider":
      return `unsupported source provider "${error.provider}"`;
  }
}
