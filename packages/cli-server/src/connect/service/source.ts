import type { MessageInitShape } from "@bufbuild/protobuf";
import { safeValidateCredentials } from "@onequery/db/server";
import type {
  Credentials,
  DataSourceStatus,
  ProviderType,
} from "@onequery/db/server";
import { ensureConnectorOrganization } from "@onequery/server/services/connectors/broker";
import { Result } from "better-result";

import { buildCliRequestLogDetails, logCliEvent } from "../../observability";
import { paginateItems } from "../../read-controls-policy";
import {
  buildCliSourceConnectGuide,
  buildCliSourceConnectResult,
} from "../../source/connect";
import {
  runCliConnectSourceEffect,
  runCliListSourcesEffect,
  runCliLoadSourceEffect,
} from "../../source/effects";
import {
  getCliQueryableDatabaseProviderType,
  sortCliSourceRecords,
} from "../../source/model";
import { requireCliConnectRequestContext } from "../context";
import { CliContentFormat } from "../gen/onequery/cli/v1/common_pb";
import {
  CliSourceConnectAmplitudeRegion,
  CliSourceConnectMixpanelRegion,
  CliSourceConnectSslMode,
  ConnectSourceResponseSchema,
  GetSourceConnectGuideResponseSchema,
  GetSourceResponseSchema,
  CliSourceStatus,
} from "../gen/onequery/cli/v1/source_pb";
import type {
  ConnectSourceCredentials,
  ConnectSourceGoogleOAuthCredentials,
  ConnectSourceServiceAccountCredentials,
} from "../gen/onequery/cli/v1/source_pb";
import {
  createCliConnectSourceNameConflictProblem,
  createCliConnectSourceNotFoundProblem,
} from "./errors";
import { buildCliPage, parseCliPaginatedReadControls } from "./read-controls";
import type { CliResultServiceMethod, CliServiceResult } from "./result";
import { cliServiceErr, liftCliServiceMethod } from "./result";
import { fromCliSourceProvider, toCliSourceProvider } from "./source-provider";

type GetSourceConnectGuideResponseInit = MessageInitShape<
  typeof GetSourceConnectGuideResponseSchema
>;
type ConnectSourceResponseInit = MessageInitShape<
  typeof ConnectSourceResponseSchema
>;
type GetSourceResponseInit = MessageInitShape<typeof GetSourceResponseSchema>;

function toCliContentFormat(value: "markdown") {
  switch (value) {
    case "markdown":
      return CliContentFormat.MARKDOWN;
  }
}

function toCliSourceStatus(value: DataSourceStatus) {
  switch (value) {
    case "active":
      return CliSourceStatus.ACTIVE;
    case "error":
      return CliSourceStatus.ERROR;
    case "disconnected":
      return CliSourceStatus.DISCONNECTED;
  }
}

type ParsedConnectSourceCredentials = {
  provider: ProviderType;
  credentials: Credentials;
};

const handleListSourcesImpl: CliResultServiceMethod<"listSources"> = async (
  request,
  context
) =>
  Result.gen(async function* handleListSourcesFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;
    const readControls = yield* parseCliPaginatedReadControls(request);
    const authorizedOrg = yield* Result.await(
      requestContext.resolveAuthorizedOrg({
        action: "source.list",
        orgSlug: request.orgSlug,
      })
    );
    const sources = await runCliListSourcesEffect({
      db: c.var.storage.db,
      effect: {
        kind: "list_sources",
        organizationId: authorizedOrg.org.id,
      },
    });
    const sortedSources = sortCliSourceRecords(sources.sources);
    const page = paginateItems(sortedSources, readControls);

    logCliEvent({
      details: buildCliRequestLogDetails(c, {
        orgSlug: authorizedOrg.org.slug,
        roles: authorizedOrg.membershipRoles,
        sourceCount: sortedSources.length,
      }),
      event: "source.list.resolved",
      level: "info",
    });

    return Result.ok({
      sources: page.items.map((source) => buildGetSourceResponse(source)),
      page: buildCliPage(page.page),
    });
  });

const handleGetSourceImpl: CliResultServiceMethod<"getSource"> = async (
  request,
  context
) =>
  Result.gen(async function* handleGetSourceFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;
    const authorizedOrg = yield* Result.await(
      requestContext.resolveAuthorizedOrg({
        action: "source.read",
        orgSlug: request.orgSlug,
      })
    );
    const source = await runCliLoadSourceEffect({
      db: c.var.storage.db,
      effect: {
        kind: "load_source",
        organizationId: authorizedOrg.org.id,
        sourceKey: request.sourceKey,
      },
    });

    if (source.kind === "not_found") {
      logCliEvent({
        details: buildCliRequestLogDetails(c, {
          orgSlug: authorizedOrg.org.slug,
          roles: authorizedOrg.membershipRoles,
          sourceKey: request.sourceKey,
        }),
        event: "source.lookup.not_found",
        level: "warn",
      });

      return Result.err(
        createCliConnectSourceNotFoundProblem(
          authorizedOrg.org.slug,
          request.sourceKey
        )
      );
    }

    const queryable =
      getCliQueryableDatabaseProviderType(
        source.source.provider,
        source.source.status
      ) !== null;

    logCliEvent({
      details: buildCliRequestLogDetails(c, {
        orgSlug: authorizedOrg.org.slug,
        roles: authorizedOrg.membershipRoles,
        sourceKey: request.sourceKey,
        provider: source.source.provider,
        queryable,
      }),
      event: "source.lookup.resolved",
      level: "info",
    });

    return Result.ok(
      buildGetSourceResponse(source.source) satisfies GetSourceResponseInit
    );
  });

const handleGetSourceConnectGuideImpl: CliResultServiceMethod<
  "getSourceConnectGuide"
> = async (request, context) =>
  Result.gen(async function* handleGetSourceConnectGuideFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;
    const authorizedOrg = yield* Result.await(
      requestContext.resolveAuthorizedOrg({
        action: "source.connect",
        orgSlug: request.orgSlug,
      })
    );
    const provider = yield* fromCliSourceProvider(request.source);
    const guide = buildCliSourceConnectGuide(provider);

    logCliEvent({
      details: buildCliRequestLogDetails(c, {
        orgSlug: authorizedOrg.org.slug,
        provider,
        roles: authorizedOrg.membershipRoles,
      }),
      event: "source.connect.guide_served",
      level: "info",
    });

    return Result.ok({
      title: guide.title,
      description: guide.description,
      format: toCliContentFormat(guide.format),
      content: guide.content,
      command: guide.command,
    } satisfies GetSourceConnectGuideResponseInit);
  });

const handleConnectSourceImpl: CliResultServiceMethod<"connectSource"> = async (
  request,
  context
) =>
  Result.gen(async function* handleConnectSourceFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const c = requestContext.honoContext;
    const authorizedOrg = yield* Result.await(
      requestContext.resolveAuthorizedOrg({
        action: "source.connect",
        orgSlug: request.orgSlug,
      })
    );
    const { credentials, provider } = yield* parseConnectSourceCredentials(
      request.credentials
    );
    const parsedCredentials = safeValidateCredentials(credentials);
    if (!parsedCredentials.success) {
      return createCliConnectSourceValidationError(parsedCredentials.error);
    }

    if (
      provider === "aws_athena_connector" &&
      parsedCredentials.data.type === "aws_athena_connector"
    ) {
      const organizationCheck = await ensureConnectorOrganization({
        connectorId: parsedCredentials.data.connectorId,
        db: c.var.storage.db,
        organizationId: authorizedOrg.org.id,
      });
      if (organizationCheck.isErr()) {
        return cliServiceErr({
          detail: organizationCheck.error.message,
          key: "SOURCE_REQUEST_INVALID",
        });
      }
    }

    const result = await runCliConnectSourceEffect({
      db: c.var.storage.db,
      effect: {
        credentials: parsedCredentials.data,
        kind: "connect_source",
        name: request.name,
        organizationId: authorizedOrg.org.id,
        provider,
      },
      masterEncryptionKey: c.var.runtime.crypto.masterEncryptionKey,
    });
    if (result.kind === "name_conflict") {
      return Result.err(
        createCliConnectSourceNameConflictProblem(
          authorizedOrg.org.slug,
          result.sourceName
        )
      );
    }

    const response = buildCliSourceConnectResult(result.source);

    logCliEvent({
      details: buildCliRequestLogDetails(c, {
        orgSlug: authorizedOrg.org.slug,
        provider: response.source.provider,
        roles: authorizedOrg.membershipRoles,
        sourceName: response.source.sourceKey,
      }),
      event: "source.connect.created",
      level: "info",
    });

    return Result.ok({
      nextCommand: response.nextCommand,
      source: buildGetSourceResponse(response.source),
    } satisfies ConnectSourceResponseInit);
  });

export const handleListSources = liftCliServiceMethod(handleListSourcesImpl);

export const handleGetSource = liftCliServiceMethod(handleGetSourceImpl);

export const handleGetSourceConnectGuide = liftCliServiceMethod(
  handleGetSourceConnectGuideImpl
);

export const handleConnectSource = liftCliServiceMethod(
  handleConnectSourceImpl
);

export function buildGetSourceResponse(source: {
  sourceKey: string;
  displayName?: string | null;
  provider: ProviderType;
  status: DataSourceStatus;
}): GetSourceResponseInit {
  const response: GetSourceResponseInit = {
    name: source.sourceKey,
    provider: toCliSourceProvider(source.provider),
    queryable:
      getCliQueryableDatabaseProviderType(source.provider, source.status) !==
      null,
    status: toCliSourceStatus(source.status),
  };

  if (source.displayName) {
    response.displayName = source.displayName;
  }

  return response;
}

function createCliConnectSourceValidationError(input: {
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

function parseConnectSourceCredentials(
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
        credentials: {
          type: "aws_athena_connector",
          connectorId: kind.value.connectorId,
          database: kind.value.database,
          ...(kind.value.maxRows !== undefined
            ? { maxRows: kind.value.maxRows }
            : {}),
          ...(kind.value.timeoutMs !== undefined
            ? { timeoutMs: kind.value.timeoutMs }
            : {}),
          ...(kind.value.workgroup ? { workgroup: kind.value.workgroup } : {}),
        },
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

function postgresCredentialsFromMessage(input: {
  database: string;
  host: string;
  password: string;
  port?: number;
  sslMode?: CliSourceConnectSslMode;
  username: string;
}) {
  const sslMode = sslModeFromMessage(input.sslMode) ?? "prefer";

  return {
    database: input.database,
    host: input.host,
    password: input.password,
    port: input.port ?? 5432,
    sslMode,
    username: input.username,
  };
}

function mySqlCredentialsFromMessage(input: {
  database: string;
  host: string;
  password: string;
  port?: number;
  sslMode?: CliSourceConnectSslMode;
  username: string;
}) {
  const sslMode = sslModeFromMessage(input.sslMode) ?? "prefer";

  return {
    database: input.database,
    host: input.host,
    password: input.password,
    port: input.port ?? 3306,
    sslMode,
    username: input.username,
  };
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
  value: CliSourceConnectSslMode | undefined
): "disable" | "prefer" | "require" | undefined {
  switch (value) {
    case undefined:
    case CliSourceConnectSslMode.UNSPECIFIED:
      return undefined;
    case CliSourceConnectSslMode.DISABLE:
      return "disable";
    case CliSourceConnectSslMode.PREFER:
      return "prefer";
    case CliSourceConnectSslMode.REQUIRE:
      return "require";
  }
}

function amplitudeRegionFromMessage(
  value: CliSourceConnectAmplitudeRegion | undefined
): "us" | "eu" | undefined {
  switch (value) {
    case undefined:
    case CliSourceConnectAmplitudeRegion.UNSPECIFIED:
      return undefined;
    case CliSourceConnectAmplitudeRegion.US:
      return "us";
    case CliSourceConnectAmplitudeRegion.EU:
      return "eu";
  }
}

function mixpanelRegionFromMessage(
  value: CliSourceConnectMixpanelRegion | undefined
): "us" | "eu" | "in" | undefined {
  switch (value) {
    case undefined:
    case CliSourceConnectMixpanelRegion.UNSPECIFIED:
      return undefined;
    case CliSourceConnectMixpanelRegion.US:
      return "us";
    case CliSourceConnectMixpanelRegion.EU:
      return "eu";
    case CliSourceConnectMixpanelRegion.IN:
      return "in";
  }
}
