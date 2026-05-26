import {
  runCliExecuteSqlEffect,
  runCliLoadQueryCredentialsEffect,
  runCliPersistQueryUsageEffect,
  runCliValidateQueryEffect,
} from "../../../query/effects";
import { runCliLoadSourceEffect } from "../../../source/effects";
import type { CliHonoContext } from "../types";

export function createCliQueryValidationDispatch(c: CliHonoContext) {
  return {
    loadSource: async (
      effect: Parameters<typeof runCliLoadSourceEffect>[0]["effect"]
    ) =>
      runCliLoadSourceEffect({
        db: c.var.storage.db,
        effect,
      }),
    validateQuery: runCliValidateQueryEffect,
  };
}

export function createCliQueryExecutionDispatch(c: CliHonoContext) {
  return {
    loadSource: async (
      effect: Parameters<typeof runCliLoadSourceEffect>[0]["effect"]
    ) =>
      runCliLoadSourceEffect({
        db: c.var.storage.db,
        effect,
      }),
    validateQuery: runCliValidateQueryEffect,
    loadCredentials: async (
      effect: Parameters<typeof runCliLoadQueryCredentialsEffect>[0]["effect"]
    ) =>
      runCliLoadQueryCredentialsEffect({
        db: c.var.storage.db,
        googleOAuthConfig: c.var.runtime.credentials?.googleOAuth,
        masterEncryptionKey: c.var.runtime.crypto.masterEncryptionKey,
        effect,
      }),
    executeSql: async (
      effect: Parameters<typeof runCliExecuteSqlEffect>[0]["effect"]
    ) =>
      runCliExecuteSqlEffect({
        db: c.var.storage.db,
        effect,
      }),
    persistUsage: async (
      effect: Parameters<typeof runCliPersistQueryUsageEffect>[0]["effect"]
    ) =>
      runCliPersistQueryUsageEffect({
        db: c.var.storage.db,
        effect,
      }),
  };
}
