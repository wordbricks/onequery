import { and, eq, getDatabaseSchema } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { encryptCredentialsObject } from "@onequery/server/services/crypto/credential-encryption";
import { prepareDataSourceCredentials } from "@onequery/server/services/data-source-credentials/prepare-data-source-credentials";
import {
  serializeDataSourceTestOutcome,
  testDataSource,
} from "@onequery/server/services/data-source-tester";

import type {
  CliConnectSourceEffect,
  CliConnectSourceEffectResult,
  CliListSourcesEffect,
  CliListSourcesEffectResult,
  CliLoadSourceEffect,
  CliLoadSourceEffectResult,
  CliTestSourceEffect,
  CliTestSourceEffectResult,
} from "../domain/effects";
import { createCliQuerySourceRecord, createCliSourceRecord } from "./model";

export async function runCliListSourcesEffect(input: {
  db: Database;
  effect: CliListSourcesEffect;
}): Promise<CliListSourcesEffectResult> {
  const { dataSources } = getDatabaseSchema(input.db);
  const rows = await input.db.query.dataSources.findMany({
    columns: {
      id: true,
      name: true,
      provider: true,
      status: true,
    },
    where: eq(dataSources.organizationId, input.effect.organizationId),
  });

  return {
    kind: "sources_loaded",
    sources: rows.flatMap((row) => {
      const source = createCliSourceRecord(row);
      return source ? [source] : [];
    }),
  };
}

export async function runCliLoadSourceEffect(input: {
  db: Database;
  effect: CliLoadSourceEffect;
}): Promise<CliLoadSourceEffectResult> {
  const { dataSources } = getDatabaseSchema(input.db);
  const row = await input.db.query.dataSources.findFirst({
    columns: {
      id: true,
      name: true,
      organizationId: true,
      provider: true,
      status: true,
      credentialsEncrypted: true,
      credentialsIv: true,
    },
    where: and(
      eq(dataSources.organizationId, input.effect.organizationId),
      eq(dataSources.name, input.effect.sourceKey)
    ),
  });

  if (!row) {
    return {
      kind: "not_found",
    };
  }

  const source = createCliQuerySourceRecord(row);
  if (!source) {
    return {
      kind: "not_found",
    };
  }

  return {
    kind: "found",
    source,
  };
}

export async function runCliConnectSourceEffect(input: {
  db: Database;
  effect: CliConnectSourceEffect;
  masterEncryptionKey: Uint8Array;
}): Promise<CliConnectSourceEffectResult> {
  const { dataSources } = getDatabaseSchema(input.db);
  const encrypted = encryptCredentialsObject(
    input.effect.credentials,
    input.masterEncryptionKey
  );

  const [inserted] = await input.db
    .insert(dataSources)
    .values({
      credentialsEncrypted: encrypted.ciphertext,
      credentialsIv: encrypted.iv,
      name: input.effect.name,
      organizationId: input.effect.organizationId,
      provider: input.effect.provider,
      status: "active",
    })
    .onConflictDoNothing({
      target: [dataSources.organizationId, dataSources.name],
    })
    .returning({
      id: dataSources.id,
      name: dataSources.name,
      provider: dataSources.provider,
      status: dataSources.status,
    });

  if (!inserted) {
    return {
      kind: "name_conflict",
      sourceName: input.effect.name,
    };
  }

  const source = createCliSourceRecord(inserted);
  if (!source) {
    return {
      kind: "name_conflict",
      sourceName: input.effect.name,
    };
  }

  return {
    kind: "connected",
    source,
  };
}

export async function runCliTestSourceEffect(input: {
  db: Database;
  effect: CliTestSourceEffect;
  masterEncryptionKey: Uint8Array;
}): Promise<CliTestSourceEffectResult> {
  const preparedCredentials = await prepareDataSourceCredentials({
    dataSource: {
      credentialsEncrypted: input.effect.source.credentialsEncrypted,
      credentialsIv: input.effect.source.credentialsIv,
      id: input.effect.source.id,
      name: input.effect.source.name,
      provider: input.effect.source.provider,
    },
    masterEncryptionKey: input.masterEncryptionKey,
  });

  if (preparedCredentials.isErr()) {
    const latencyMs = 0;
    const now = new Date();
    const { dataSources } = getDatabaseSchema(input.db);

    // Comment: source test treats credential decode/provider mismatches as an
    // explicit failed test result so CLI callers can script against one stable
    // response shape instead of branching on transport vs. domain failures.
    await input.db
      .update(dataSources)
      .set({
        errorMessage: preparedCredentials.error.message,
        lastUsedAt: now,
        status: "error",
        updatedAt: now,
      })
      .where(eq(dataSources.id, input.effect.source.id));

    return {
      kind: "supported",
      success: false,
      message: "Connection test failed.",
      error: preparedCredentials.error.message,
      latencyMs,
    };
  }

  const outcome = await testDataSource(preparedCredentials.value.credentials, {
    db: input.db,
    organizationId: input.effect.organizationId,
  });
  const serialized = serializeDataSourceTestOutcome(outcome);

  if (serialized.kind === "unsupported") {
    return serialized;
  }

  const now = new Date();
  const { dataSources } = getDatabaseSchema(input.db);
  await input.db
    .update(dataSources)
    .set({
      errorMessage: serialized.result.success ? null : serialized.result.error,
      lastUsedAt: now,
      status: serialized.result.success ? "active" : "error",
      updatedAt: now,
    })
    .where(eq(dataSources.id, input.effect.source.id));

  if (serialized.result.success) {
    return {
      kind: "supported",
      success: true,
      message: serialized.result.message,
      latencyMs: serialized.result.latencyMs,
    };
  }

  return {
    kind: "supported",
    success: false,
    message: serialized.result.message,
    error: serialized.result.error,
    latencyMs: serialized.result.latencyMs,
  };
}
