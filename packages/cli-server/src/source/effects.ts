import { and, eq, getDatabaseSchema } from "@onequery/db/server";
import type { Database } from "@onequery/db/server";
import { encryptCredentialsObject } from "@onequery/server/services/crypto/credential-encryption";

import type {
  CliConnectSourceEffect,
  CliConnectSourceEffectResult,
  CliListSourcesEffect,
  CliListSourcesEffectResult,
  CliLoadSourceEffect,
  CliLoadSourceEffectResult,
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
