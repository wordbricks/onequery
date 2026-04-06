import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

import type { CliAction } from "../../authorization";
import type { CliSessionIdentity } from "../../domain/workflows";
import type { CliUseSource as CliUseSkillSource } from "../../use/skills";
import { throwCliConnectError } from "../error";
import { CliAuthMode } from "../gen/onequery/cli/v1/auth_pb";
import { CliContentFormat } from "../gen/onequery/cli/v1/common_pb";
import { CliOrgCapability } from "../gen/onequery/cli/v1/org_pb";
import { CliQueryLogicalType } from "../gen/onequery/cli/v1/query_pb";
import {
  CliSourceProvider,
  CliSourceStatus,
} from "../gen/onequery/cli/v1/source_pb";
import { CliUseSource } from "../gen/onequery/cli/v1/use_pb";

export function timestampFromIsoString(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }

  return timestampFromDate(parsed);
}

export function toCliAuthMode(value: CliSessionIdentity["authMode"]) {
  switch (value) {
    case "browser_session":
      return CliAuthMode.BROWSER_SESSION;
    case "bearer_token":
      return CliAuthMode.BEARER_TOKEN;
  }
}

export function toCliUseSourceEnum(value: CliUseSkillSource) {
  switch (value) {
    case "amplitude":
      return CliUseSource.AMPLITUDE;
    case "ga":
      return CliUseSource.GA;
    case "github":
      return CliUseSource.GITHUB;
    case "mixpanel":
      return CliUseSource.MIXPANEL;
    case "mongodb":
      return CliUseSource.MONGODB;
    case "posthog":
      return CliUseSource.POSTHOG;
    case "sentry":
      return CliUseSource.SENTRY;
  }
}

export function fromCliUseSource(value: CliUseSource): CliUseSkillSource {
  switch (value) {
    case CliUseSource.AMPLITUDE:
      return "amplitude";
    case CliUseSource.GA:
      return "ga";
    case CliUseSource.GITHUB:
      return "github";
    case CliUseSource.MIXPANEL:
      return "mixpanel";
    case CliUseSource.MONGODB:
      return "mongodb";
    case CliUseSource.POSTHOG:
      return "posthog";
    case CliUseSource.SENTRY:
      return "sentry";
    default:
      throwCliConnectError({
        detail: "unsupported use source",
        hint: "choose one of the supported use sources and retry",
        key: "INVALID_REQUEST",
        stage: "resolve_source",
      });
  }
}

export function toCliContentFormat(value: "markdown") {
  switch (value) {
    case "markdown":
      return CliContentFormat.MARKDOWN;
  }
}

export function toCliOrgCapability(value: CliAction) {
  switch (value) {
    case "org.list":
      return CliOrgCapability.ORG_LIST;
    case "org.read":
      return CliOrgCapability.ORG_READ;
    case "source.connect":
      return CliOrgCapability.SOURCE_CONNECT;
    case "source.list":
      return CliOrgCapability.SOURCE_LIST;
    case "source.read":
      return CliOrgCapability.SOURCE_READ;
    case "query.execute":
      return CliOrgCapability.QUERY_EXECUTE;
  }
}

export function toCliSourceProvider(value: ProviderType) {
  switch (value) {
    case "postgres":
      return CliSourceProvider.POSTGRES;
    case "supabase":
      return CliSourceProvider.SUPABASE;
    case "mysql":
      return CliSourceProvider.MYSQL;
    case "mongodb":
      return CliSourceProvider.MONGODB;
    case "bigquery":
      return CliSourceProvider.BIGQUERY;
    case "laminar":
      return CliSourceProvider.LAMINAR;
    case "aws_athena_connector":
      return CliSourceProvider.AWS_ATHENA_CONNECTOR;
    case "ga":
      return CliSourceProvider.GA;
    case "amplitude":
      return CliSourceProvider.AMPLITUDE;
    case "mixpanel":
      return CliSourceProvider.MIXPANEL;
    case "posthog":
      return CliSourceProvider.POSTHOG;
    case "sentry":
      return CliSourceProvider.SENTRY;
    case "github":
      return CliSourceProvider.GITHUB;
    case "linear":
      return CliSourceProvider.LINEAR;
  }
}

export function fromCliSourceProvider(value: CliSourceProvider): ProviderType {
  switch (value) {
    case CliSourceProvider.POSTGRES:
      return "postgres";
    case CliSourceProvider.SUPABASE:
      return "supabase";
    case CliSourceProvider.MYSQL:
      return "mysql";
    case CliSourceProvider.MONGODB:
      return "mongodb";
    case CliSourceProvider.BIGQUERY:
      return "bigquery";
    case CliSourceProvider.LAMINAR:
      return "laminar";
    case CliSourceProvider.AWS_ATHENA_CONNECTOR:
      return "aws_athena_connector";
    case CliSourceProvider.GA:
      return "ga";
    case CliSourceProvider.AMPLITUDE:
      return "amplitude";
    case CliSourceProvider.MIXPANEL:
      return "mixpanel";
    case CliSourceProvider.POSTHOG:
      return "posthog";
    case CliSourceProvider.SENTRY:
      return "sentry";
    case CliSourceProvider.GITHUB:
      return "github";
    case CliSourceProvider.LINEAR:
      return "linear";
    default:
      throwCliConnectError({
        detail: "unsupported source provider",
        hint: "choose a supported source provider and retry",
        key: "INVALID_REQUEST",
        stage: "resolve_source",
      });
  }
}

export function toCliSourceStatus(value: DataSourceStatus) {
  switch (value) {
    case "active":
      return CliSourceStatus.ACTIVE;
    case "error":
      return CliSourceStatus.ERROR;
    case "disconnected":
      return CliSourceStatus.DISCONNECTED;
  }
}

export function toCliQueryLogicalType(value: string) {
  switch (value) {
    case "string":
      return CliQueryLogicalType.STRING;
    case "number":
      return CliQueryLogicalType.NUMBER;
    case "boolean":
      return CliQueryLogicalType.BOOLEAN;
    case "bigint":
      return CliQueryLogicalType.BIGINT;
    case "datetime":
      return CliQueryLogicalType.DATETIME;
    case "array":
      return CliQueryLogicalType.ARRAY;
    case "json":
      return CliQueryLogicalType.JSON;
    default:
      return undefined;
  }
}
