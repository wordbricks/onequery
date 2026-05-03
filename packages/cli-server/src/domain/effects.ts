import type {
  DatabaseCredentialProviderType,
  DatabaseCredentials,
  ProviderType,
} from "@onequery/db/server";
import type { UnsupportedTestReason } from "@onequery/server/services/data-source-tester";

import type {
  CliQueryExecutionResult,
  CliQuerySourceRecord,
  CliSourceRecord,
} from "./workflows";

export type CliListSourcesEffect = {
  kind: "list_sources";
  organizationId: string;
};

export type CliListSourcesEffectResult = {
  kind: "sources_loaded";
  sources: CliSourceRecord[];
};

export type CliLoadSourceEffect = {
  kind: "load_source";
  organizationId: string;
  sourceKey: string;
};

export type CliLoadSourceEffectResult =
  | {
      kind: "found";
      source: CliQuerySourceRecord;
    }
  | {
      kind: "not_found";
    };

export type CliConnectSourceEffect = {
  kind: "connect_source";
  organizationId: string;
  name: string;
  provider: ProviderType;
  credentials: unknown;
};

export type CliConnectSourceEffectResult =
  | {
      kind: "connected";
      source: CliSourceRecord;
    }
  | {
      kind: "name_conflict";
      sourceName: string;
    };

export type CliTestSourceEffect = {
  kind: "test_source";
  organizationId: string;
  source: CliQuerySourceRecord;
};

export type CliTestSourceEffectResult =
  | {
      kind: "supported";
      success: true;
      message: string;
      latencyMs: number;
    }
  | {
      kind: "supported";
      success: false;
      message: string;
      error: string;
      latencyMs: number;
    }
  | {
      kind: "unsupported";
      reason: UnsupportedTestReason;
      message: string;
    };

export type CliLoadCredentialsEffect = {
  kind: "load_credentials";
  source: CliQuerySourceRecord;
};

export type CliLoadCredentialsEffectResult =
  | {
      kind: "credentials_loaded";
      source: CliQuerySourceRecord;
      credentials: DatabaseCredentials;
    }
  | {
      kind: "credentials_invalid";
      source: CliQuerySourceRecord;
      detail: string;
    };

export type CliValidateQueryEffect = {
  kind: "validate_query";
  sql: string;
  databaseType: DatabaseCredentialProviderType;
};

export type CliValidateQueryEffectResult =
  | {
      kind: "query_ready";
      normalizedSql: string;
      truncated: boolean;
    }
  | {
      kind: "query_rejected";
      detail: string;
    }
  | {
      kind: "query_preparation_failed";
      detail: string;
      hint: string;
    };

export type CliExecuteSqlEffect = {
  kind: "execute_sql";
  requestId: string;
  source: CliQuerySourceRecord;
  credentials: DatabaseCredentials;
  normalizedSql: string;
  clientTimeoutMs: number;
};

export type CliExecuteSqlEffectResult = CliQueryExecutionResult;

export type CliPersistUsageEffect = {
  kind: "persist_usage";
  sourceId: string;
};

export type CliPersistUsageEffectResult =
  | {
      kind: "usage_persisted";
    }
  | {
      kind: "usage_persist_failed";
      sourceId: string;
      detail: string;
    };
