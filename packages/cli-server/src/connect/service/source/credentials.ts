import { isFieldSet } from "@bufbuild/protobuf";
import type { Credentials } from "@onequery/db/server";
import { Result } from "better-result";

import {
  ConnectSourceAwsAthenaConnectorCredentialsSchema,
  ConnectSourceMySqlCredentialsSchema,
  ConnectSourcePostgresCredentialsSchema,
  SourceConnectAmplitudeRegion,
  SourceConnectMixpanelRegion,
  SourceConnectSslMode,
} from "../../gen/onequery/cli/v1/source_pb";
import type {
  ConnectSourceAwsAthenaConnectorCredentials,
  ConnectSourceCredentials,
  ConnectSourceGoogleOAuthCredentials,
  ConnectSourceMySqlCredentials,
  ConnectSourcePostgresCredentials,
  ConnectSourceServiceAccountCredentials,
} from "../../gen/onequery/cli/v1/source_pb";
import { cliServiceErr } from "../result";
import type { CliServiceResult } from "../result";
import type { ParsedConnectSourceCredentials } from "./types";

export function createCliConnectSourceValidationError(input: {
  issues: readonly {
    code: string;
    path: ReadonlyArray<PropertyKey>;
    message: string;
  }[];
}): CliServiceResult<never> {
  const issue = input.issues[0];

  return cliServiceErr({
    detail: issue?.message ?? "invalid source connect request",
    errors: input.issues.map((validationIssue) => ({
      code: validationIssue.code,
      field: validationIssue.path.map((segment) => String(segment)).join("."),
      message: validationIssue.message,
    })),
    key: "SOURCE_REQUEST_INVALID",
  });
}

export function parseConnectSourceCredentials(
  credentials: ConnectSourceCredentials | undefined
): CliServiceResult<ParsedConnectSourceCredentials> {
  const kind = credentials?.kind;

  switch (kind?.case) {
    case "postgres":
      return Result.ok({
        provider: "postgres",
        credentials: {
          type: "postgres",
          ...postgresCredentialsFromMessage(kind.value),
        },
      });
    case "supabase":
      return Result.ok({
        provider: "supabase",
        credentials: {
          type: "postgres",
          ...postgresCredentialsFromMessage(kind.value),
        },
      });
    case "mysql":
      return Result.ok({
        provider: "mysql",
        credentials: {
          type: "mysql",
          ...mySqlCredentialsFromMessage(kind.value),
        },
      });
    case "mongodb":
      return Result.ok({
        provider: "mongodb",
        credentials: {
          type: "mongodb",
          connectionString: kind.value.connectionString,
          ...(kind.value.database ? { database: kind.value.database } : {}),
          ...(kind.value.databases.length > 0
            ? { databases: [...kind.value.databases] }
            : {}),
        },
      });
    case "bigquery":
      return bigQueryCredentialsFromMessage(kind.value).map((parsed) => ({
        provider: "bigquery",
        credentials: parsed,
      }));
    case "laminar":
      return Result.ok({
        provider: "laminar",
        credentials: {
          type: "laminar",
          apiKey: kind.value.apiKey,
          ...(kind.value.apiBaseUrl
            ? { apiBaseUrl: kind.value.apiBaseUrl }
            : {}),
        },
      });
    case "awsAthenaConnector":
      return Result.ok({
        provider: "aws_athena_connector",
        credentials: awsAthenaConnectorCredentialsFromMessage(kind.value),
      });
    case "ga":
      return googleAnalyticsCredentialsFromMessage(kind.value).map(
        (parsed) => ({
          provider: "ga",
          credentials: parsed,
        })
      );
    case "amplitude":
      return Result.ok({
        provider: "amplitude",
        credentials: {
          type: "amplitude",
          apiKey: kind.value.apiKey,
          region: amplitudeRegionFromMessage(kind.value.region) ?? "us",
          secretKey: kind.value.secretKey,
        },
      });
    case "mixpanel":
      return Result.ok({
        provider: "mixpanel",
        credentials: {
          type: "mixpanel",
          projectId: kind.value.projectId,
          region: mixpanelRegionFromMessage(kind.value.region) ?? "us",
          secret: kind.value.secret,
          username: kind.value.username,
          ...(kind.value.workspaceId
            ? { workspaceId: kind.value.workspaceId }
            : {}),
        },
      });
    case "posthog":
      return Result.ok({
        provider: "posthog",
        credentials: {
          type: "posthog",
          hostUrl: kind.value.hostUrl,
          personalApiKey: kind.value.personalApiKey,
          projectId: kind.value.projectId,
        },
      });
    case "sentry":
      return Result.ok({
        provider: "sentry",
        credentials: {
          type: "sentry",
          authToken: kind.value.authToken,
          organizationSlug: kind.value.organizationSlug,
          ...(kind.value.apiBaseUrl
            ? { apiBaseUrl: kind.value.apiBaseUrl }
            : {}),
          ...(kind.value.projectSlug
            ? { projectSlug: kind.value.projectSlug }
            : {}),
        },
      });
    case "github":
      return Result.ok({
        provider: "github",
        credentials: {
          type: "github",
          accessToken: kind.value.accessToken,
          ...(kind.value.installationId
            ? { installationId: kind.value.installationId }
            : {}),
          ...(kind.value.repositories.length > 0
            ? { repositories: [...kind.value.repositories] }
            : {}),
        },
      });
    case "linear":
      return linearCredentialsFromMessage(kind.value).map((parsed) => ({
        provider: "linear",
        credentials: parsed,
      }));
    default:
      return cliServiceErr({
        detail: "source connect request must include typed credentials",
        key: "SOURCE_REQUEST_INVALID",
      });
  }
}

function postgresCredentialsFromMessage(
  input: ConnectSourcePostgresCredentials
) {
  // Comment: generated Connect request messages expose absent edition scalars as
  // zero-valued properties, so use `isFieldSet()` anywhere "unset" should fall
  // back to a transport default instead of meaning the numeric zero.
  const port = isFieldSet(
    input,
    ConnectSourcePostgresCredentialsSchema.field.port
  )
    ? input.port
    : undefined;
  const sslMode = sslModeFromMessage(input.sslMode) ?? "prefer";

  return {
    database: input.database,
    host: input.host,
    password: input.password,
    port: port ?? 5432,
    sslMode,
    username: input.username,
  };
}

function mySqlCredentialsFromMessage(input: ConnectSourceMySqlCredentials) {
  const port = isFieldSet(input, ConnectSourceMySqlCredentialsSchema.field.port)
    ? input.port
    : undefined;
  const sslMode = sslModeFromMessage(input.sslMode) ?? "prefer";

  return {
    database: input.database,
    host: input.host,
    password: input.password,
    port: port ?? 3306,
    sslMode,
    username: input.username,
  };
}

function awsAthenaConnectorCredentialsFromMessage(
  input: ConnectSourceAwsAthenaConnectorCredentials
) {
  const maxRows = isFieldSet(
    input,
    ConnectSourceAwsAthenaConnectorCredentialsSchema.field.maxRows
  )
    ? input.maxRows
    : undefined;
  const timeoutMs = isFieldSet(
    input,
    ConnectSourceAwsAthenaConnectorCredentialsSchema.field.timeoutMs
  )
    ? input.timeoutMs
    : undefined;

  return {
    type: "aws_athena_connector",
    connectorId: input.connectorId,
    database: input.database,
    ...(maxRows !== undefined ? { maxRows } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(input.workgroup ? { workgroup: input.workgroup } : {}),
  } satisfies Credentials;
}

function bigQueryCredentialsFromMessage(input: {
  auth:
    | {
        case: "oauth";
        value: {
          projectId: string;
          credentials?: ConnectSourceGoogleOAuthCredentials;
        };
      }
    | {
        case: "serviceAccount";
        value: {
          projectId: string;
          serviceAccount?: ConnectSourceServiceAccountCredentials;
        };
      }
    | { case: undefined; value?: undefined };
}): CliServiceResult<Credentials> {
  switch (input.auth.case) {
    case "oauth": {
      const oauth = input.auth.value;
      const credentials = requirePresent(
        oauth.credentials,
        "bigquery oauth credentials are required"
      );
      if (credentials.isErr()) {
        return Result.err(credentials.error);
      }

      const expiresAt = numberFromUInt64(
        credentials.value.expiresAt,
        "bigquery.expiresAt"
      );
      if (expiresAt.isErr()) {
        return Result.err(expiresAt.error);
      }

      const parsed = {
        type: "bigquery",
        projectId: oauth.projectId,
        accessToken: credentials.value.accessToken,
        refreshToken: credentials.value.refreshToken,
        expiresAt: expiresAt.value,
      } satisfies Credentials;

      return Result.ok(parsed);
    }
    case "serviceAccount": {
      const serviceAccount = requirePresent(
        input.auth.value.serviceAccount,
        "bigquery service account credentials are required"
      );
      if (serviceAccount.isErr()) {
        return Result.err(serviceAccount.error);
      }

      const parsed = {
        type: "bigquery",
        authType: "service_account",
        projectId: input.auth.value.projectId,
        serviceAccount: serviceAccountCredentialsFromMessage(
          serviceAccount.value
        ),
      } satisfies Credentials;

      return Result.ok(parsed);
    }
    default:
      return cliServiceErr({
        detail: "bigquery credentials must choose one auth mode",
        key: "SOURCE_REQUEST_INVALID",
      });
  }
}

function googleAnalyticsCredentialsFromMessage(input: {
  auth:
    | {
        case: "oauth";
        value: {
          propertyId: string;
          credentials?: ConnectSourceGoogleOAuthCredentials;
        };
      }
    | {
        case: "serviceAccount";
        value: {
          propertyId: string;
          serviceAccount?: ConnectSourceServiceAccountCredentials;
        };
      }
    | { case: undefined; value?: undefined };
}): CliServiceResult<Credentials> {
  switch (input.auth.case) {
    case "oauth": {
      const oauth = input.auth.value;
      const credentials = requirePresent(
        oauth.credentials,
        "google analytics oauth credentials are required"
      );
      if (credentials.isErr()) {
        return Result.err(credentials.error);
      }

      const expiresAt = numberFromUInt64(
        credentials.value.expiresAt,
        "ga.expiresAt"
      );
      if (expiresAt.isErr()) {
        return Result.err(expiresAt.error);
      }

      const parsed = {
        type: "ga",
        propertyId: oauth.propertyId,
        accessToken: credentials.value.accessToken,
        refreshToken: credentials.value.refreshToken,
        expiresAt: expiresAt.value,
      } satisfies Credentials;

      return Result.ok(parsed);
    }
    case "serviceAccount": {
      const serviceAccount = requirePresent(
        input.auth.value.serviceAccount,
        "google analytics service account credentials are required"
      );
      if (serviceAccount.isErr()) {
        return Result.err(serviceAccount.error);
      }

      const parsed = {
        type: "ga",
        authType: "service_account",
        propertyId: input.auth.value.propertyId,
        serviceAccount: serviceAccountCredentialsFromMessage(
          serviceAccount.value
        ),
      } satisfies Credentials;

      return Result.ok(parsed);
    }
    default:
      return cliServiceErr({
        detail: "google analytics credentials must choose one auth mode",
        key: "SOURCE_REQUEST_INVALID",
      });
  }
}

function linearCredentialsFromMessage(input: {
  auth:
    | { case: "apiKey"; value: { apiKey: string } }
    | {
        case: "oauth";
        value: {
          accessToken: string;
          appUserId?: string;
          expiresAt?: string;
          linearOrganizationId: string;
          linearOrganizationName?: string;
          refreshToken?: string;
          scope?: string;
          tokenType?: string;
        };
      }
    | { case: undefined; value?: undefined };
}): CliServiceResult<Credentials> {
  switch (input.auth.case) {
    case "apiKey":
      return Result.ok({
        type: "linear",
        apiKey: input.auth.value.apiKey,
      });
    case "oauth":
      return Result.ok({
        type: "linear",
        accessToken: input.auth.value.accessToken,
        linearOrganizationId: input.auth.value.linearOrganizationId,
        ...(input.auth.value.appUserId
          ? { appUserId: input.auth.value.appUserId }
          : {}),
        ...(input.auth.value.expiresAt
          ? { expiresAt: input.auth.value.expiresAt }
          : {}),
        ...(input.auth.value.linearOrganizationName
          ? { linearOrganizationName: input.auth.value.linearOrganizationName }
          : {}),
        ...(input.auth.value.refreshToken
          ? { refreshToken: input.auth.value.refreshToken }
          : {}),
        ...(input.auth.value.scope ? { scope: input.auth.value.scope } : {}),
        ...(input.auth.value.tokenType
          ? { tokenType: input.auth.value.tokenType }
          : {}),
      });
    default:
      return cliServiceErr({
        detail: "linear credentials must choose one auth mode",
        key: "SOURCE_REQUEST_INVALID",
      });
  }
}

function serviceAccountCredentialsFromMessage(
  input: ConnectSourceServiceAccountCredentials
) {
  return {
    projectId: input.projectId,
    clientEmail: input.clientEmail,
    privateKey: input.privateKey,
    ...(input.privateKeyId ? { privateKeyId: input.privateKeyId } : {}),
  };
}

function requirePresent<T>(
  value: T | undefined,
  detail: string
): CliServiceResult<T> {
  if (value !== undefined) {
    return Result.ok(value);
  }

  return cliServiceErr({
    detail,
    key: "SOURCE_REQUEST_INVALID",
  });
}

function numberFromUInt64(
  value: bigint,
  field: string
): CliServiceResult<number> {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return cliServiceErr({
      detail: `${field} exceeds the supported numeric range`,
      key: "SOURCE_REQUEST_INVALID",
    });
  }

  return Result.ok(Number(value));
}

function sslModeFromMessage(
  value: SourceConnectSslMode | undefined
): "disable" | "prefer" | "require" | undefined {
  switch (value) {
    case undefined:
    case SourceConnectSslMode.UNSPECIFIED:
      return undefined;
    case SourceConnectSslMode.DISABLE:
      return "disable";
    case SourceConnectSslMode.PREFER:
      return "prefer";
    case SourceConnectSslMode.REQUIRE:
      return "require";
  }
}

function amplitudeRegionFromMessage(
  value: SourceConnectAmplitudeRegion | undefined
): "us" | "eu" | undefined {
  switch (value) {
    case undefined:
    case SourceConnectAmplitudeRegion.UNSPECIFIED:
      return undefined;
    case SourceConnectAmplitudeRegion.US:
      return "us";
    case SourceConnectAmplitudeRegion.EU:
      return "eu";
  }
}

function mixpanelRegionFromMessage(
  value: SourceConnectMixpanelRegion | undefined
): "us" | "eu" | "in" | undefined {
  switch (value) {
    case undefined:
    case SourceConnectMixpanelRegion.UNSPECIFIED:
      return undefined;
    case SourceConnectMixpanelRegion.US:
      return "us";
    case SourceConnectMixpanelRegion.EU:
      return "eu";
    case SourceConnectMixpanelRegion.IN:
      return "in";
  }
}
