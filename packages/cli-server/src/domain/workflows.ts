import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

export type CliDisplayUserIdentity = {
  id: string;
  email: string;
  displayName: string;
};

export type CliSessionIdentity = {
  accessToken: string;
  authMode: CliSessionAuthMode;
  user: CliDisplayUserIdentity;
  activeOrg: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
};

export type CliSessionAuthMode = "browser_session" | "bearer_token";

export type CliAuthUserView = {
  id: string;
  email: string;
  displayName: string;
};

export type CliAuthWhoAmIResult = {
  authMode: CliSessionAuthMode;
  user: CliAuthUserView;
  activeOrgSlug: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
};

export type CliAuthSessionRefreshResult = {
  accessToken: string;
  authMode: CliSessionAuthMode;
  user: CliAuthUserView;
  activeOrgSlug: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
};

export type CliOrgSummary = {
  slug: string;
  name: string;
};

export type AccessibleCliOrg = {
  id: string;
  slug: string;
  name: string;
};

export type CliOrgAccessResult =
  | {
      kind: "found";
      org: AccessibleCliOrg;
      rawMembershipRole: string;
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "forbidden";
    };

export type CliOrgAccessDecision =
  | {
      kind: "org_not_found";
      orgSlug: string;
    }
  | {
      kind: "forbidden";
      orgSlug: string;
    }
  | {
      kind: "allowed";
      org: AccessibleCliOrg;
      rawMembershipRole: string;
    };

export type CliSourceRecord = {
  id: string;
  sourceKey: string;
  displayName: string | null;
  provider: ProviderType;
  status: DataSourceStatus;
};

export type CliQueryColumn = {
  name: string;
  logicalType:
    | "string"
    | "number"
    | "boolean"
    | "bigint"
    | "datetime"
    | "array"
    | "json"
    | null;
};

export type CliQuerySuccessResult = {
  source: CliSourceRecord;
  rowCount: number;
  elapsedMs: number;
  columns: CliQueryColumn[];
  rows: string[][];
  truncated: boolean;
};

export type CliQuerySourceRecord = CliSourceRecord & {
  name: string;
  organizationId: string;
  credentialsEncrypted: string;
  credentialsIv: string;
};

export type CliQueryPlanResult =
  | {
      kind: "ready";
      requestId: string;
      sourceName: string;
      source: CliSourceRecord;
      normalizedSql: string;
      timeoutMs: number | null;
      truncated: boolean;
    }
  | {
      kind: "source_not_found";
      orgSlug: string;
      sourceName: string;
      requestId: string;
    }
  | {
      kind: "source_not_queryable";
      requestId: string;
      sourceName: string;
      provider: ProviderType;
      status: DataSourceStatus;
    }
  | {
      kind: "query_rejected";
      requestId: string;
      detail: string;
    }
  | {
      kind: "query_preparation_failed";
      requestId: string;
      detail: string;
      hint?: string;
    };

export type CliQueryExecutionResult =
  | {
      kind: "succeeded";
      rows: Record<string, unknown>[];
      elapsedMs: number;
    }
  | {
      kind: "query_unavailable";
      detail: string;
      retryable: true;
    }
  | {
      kind: "query_timed_out";
      detail: string;
      retryable: true;
    }
  | {
      kind: "query_execution_failed";
      detail: string;
      retryable: false;
    };

export function toCliAuthUserView(
  user: CliDisplayUserIdentity
): CliAuthUserView {
  return {
    displayName: user.displayName,
    email: user.email,
    id: user.id,
  };
}
