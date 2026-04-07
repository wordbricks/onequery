import type { MessageInitShape } from "@bufbuild/protobuf";
import { safeValidateCredentials } from "@onequery/db/server";
import type {
  Credentials,
  DataSourceStatus,
  ProviderType,
} from "@onequery/db/server";
import { ensureConnectorOrganization } from "@onequery/server/services/connectors/broker";

import { isCliSourceKey } from "../../identifiers";
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
  buildCliSourceListResult,
  buildCliSourceSummary,
} from "../../source/model";
import { requireCliConnectRequestContext } from "../context";
import { throwCliConnectError } from "../error";
import {
  CliSourceConnectAmplitudeRegion,
  CliSourceConnectMixpanelRegion,
  CliSourceConnectSslMode,
  CliSourceProvider,
  CliSourceStatus,
  ConnectSourceResponseSchema,
  GetSourceConnectGuideResponseSchema,
  GetSourceResponseSchema,
} from "../gen/onequery/cli/v1/source_pb";
import type {
  ConnectSourceCredentials,
  ConnectSourceGoogleOAuthCredentials,
  ConnectSourceServiceAccountCredentials,
} from "../gen/onequery/cli/v1/source_pb";
import {
  fromCliSourceProvider,
  toCliContentFormat,
  toCliSourceProvider,
  toCliSourceStatus,
} from "./conversions";
import {
  throwCliConnectSourceNameConflict,
  throwCliConnectSourceNotFound,
} from "./errors";
import { buildCliPage, parseCliPaginatedReadControls } from "./read-controls";
import type { CliServiceMethod } from "./types";

type GetSourceConnectGuideResponseInit = MessageInitShape<
  typeof GetSourceConnectGuideResponseSchema
>;
type ConnectSourceResponseInit = MessageInitShape<
  typeof ConnectSourceResponseSchema
>;

type CliSourceSummaryMessage = {
  name?: string;
  displayName?: string;
  provider?: CliSourceProvider;
  queryable?: boolean;
  status?: CliSourceStatus;
};

export const handleListSources: CliServiceMethod<"listSources"> = async (
  request,
  context
) => {
  const requestContext = requireCliConnectRequestContext(context);
  const c = requestContext.honoContext;
  const readControls = parseCliPaginatedReadControls(request);
  const authorizedOrg = await requestContext.requireAuthorizedOrg({
    action: "source.list",
    orgSlug: request.orgSlug,
  });
  const sources = await runCliListSourcesEffect({
    db: c.var.storage.db,
    effect: {
      kind: "list_sources",
      organizationId: authorizedOrg.org.id,
    },
  });
  const summaries = buildCliSourceListResult(sources.sources).sources;
  const page = paginateItems(summaries, readControls);

  logCliEvent({
    details: buildCliRequestLogDetails(c, {
      orgSlug: authorizedOrg.org.slug,
      roles: authorizedOrg.membershipRoles,
      sourceCount: summaries.length,
    }),
    event: "source.list.resolved",
    level: "info",
  });

  return {
    sources: page.items.map((source) => buildCliSourceSummaryMessage(source)),
    page: buildCliPage(page.page),
  };
};

export const handleGetSource: CliServiceMethod<"getSource"> = async (
  request,
  context
) => {
  const requestContext = requireCliConnectRequestContext(context);
  const c = requestContext.honoContext;
  const authorizedOrg = await requestContext.requireAuthorizedOrg({
    action: "source.read",
    orgSlug: request.orgSlug,
  });
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
    throwCliConnectSourceNotFound(authorizedOrg.org.slug, request.sourceKey);
  }

  const summary = buildCliSourceSummary(source.source);

  logCliEvent({
    details: buildCliRequestLogDetails(c, {
      orgSlug: authorizedOrg.org.slug,
      roles: authorizedOrg.membershipRoles,
      sourceKey: request.sourceKey,
      provider: summary.provider,
      queryable: summary.queryable,
    }),
    event: "source.lookup.resolved",
    level: "info",
  });

  return buildCliSourceSummaryMessage(summary) satisfies MessageInitShape<
    typeof GetSourceResponseSchema
  >;
};

export const handleGetSourceConnectGuide: CliServiceMethod<
  "getSourceConnectGuide"
> = async (request, context) => {
  const requestContext = requireCliConnectRequestContext(context);
  const c = requestContext.honoContext;
  const authorizedOrg = await requestContext.requireAuthorizedOrg({
    action: "source.connect",
    orgSlug: request.orgSlug,
  });
  const provider = fromCliSourceProvider(request.source);
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

  return {
    title: guide.title,
    description: guide.description,
    format: toCliContentFormat(guide.format),
    content: guide.content,
    command: guide.command,
  } satisfies GetSourceConnectGuideResponseInit;
};

export const handleConnectSource: CliServiceMethod<"connectSource"> = async (
  request,
  context
) => {
  const requestContext = requireCliConnectRequestContext(context);
  const c = requestContext.honoContext;
  const authorizedOrg = await requestContext.requireAuthorizedOrg({
    action: "source.connect",
    orgSlug: request.orgSlug,
  });

  if (!isCliSourceKey(request.name)) {
    throwCliConnectError({
      detail:
        "source name must use only letters, numbers, dots, underscores, or hyphens",
      key: "INVALID_REQUEST",
    });
  }

  const { credentials, provider } = parseConnectSourceCredentials(
    request.credentials
  );
  const parsedCredentials = safeValidateCredentials(credentials);
  if (!parsedCredentials.success) {
    throwCliConnectSourceValidationError(parsedCredentials.error);
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
    if (!organizationCheck.ok) {
      throwCliConnectError({
        detail: organizationCheck.error,
        key: "INVALID_REQUEST",
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
    throwCliConnectSourceNameConflict(
      authorizedOrg.org.slug,
      result.sourceName
    );
  }

  const response = buildCliSourceConnectResult(result.source);

  logCliEvent({
    details: buildCliRequestLogDetails(c, {
      orgSlug: authorizedOrg.org.slug,
      provider: response.source.provider,
      roles: authorizedOrg.membershipRoles,
      sourceName: response.source.name,
    }),
    event: "source.connect.created",
    level: "info",
  });

  return {
    nextCommand: response.nextCommand,
    source: buildCliSourceSummaryMessage(response.source),
  } satisfies ConnectSourceResponseInit;
};

export function buildCliSourceSummaryMessage(source: {
  name?: string;
  displayName?: string | null;
  provider?: ProviderType;
  queryable?: boolean;
  status?: DataSourceStatus;
}): CliSourceSummaryMessage {
  const response: CliSourceSummaryMessage = {};

  if (source.name !== undefined) {
    response.name = source.name;
  }
  if (source.displayName) {
    response.displayName = source.displayName;
  }
  if (source.provider !== undefined) {
    response.provider = toCliSourceProvider(source.provider);
  }
  if (source.queryable !== undefined) {
    response.queryable = source.queryable;
  }
  if (source.status !== undefined) {
    response.status = toCliSourceStatus(source.status);
  }

  return response;
}
function throwCliConnectSourceValidationError(input: {
  issues: readonly {
    path: ReadonlyArray<PropertyKey>;
    message: string;
  }[];
}): never {
  const issue = input.issues[0];

  throwCliConnectError({
    detail: issue?.message ?? "invalid source connect request",
    key: "INVALID_REQUEST",
  });
}

function parseConnectSourceCredentials(
  credentials: ConnectSourceCredentials | undefined
): { provider: ProviderType; credentials: Credentials } {
  const kind = credentials?.kind;

  switch (kind?.case) {
    case "postgres":
      return {
        provider: "postgres",
        credentials: {
          type: "postgres",
          ...postgresCredentialsFromMessage(kind.value),
        },
      };
    case "supabase":
      return {
        provider: "supabase",
        credentials: {
          type: "postgres",
          ...postgresCredentialsFromMessage(kind.value),
        },
      };
    case "mysql":
      return {
        provider: "mysql",
        credentials: {
          type: "mysql",
          ...mySqlCredentialsFromMessage(kind.value),
        },
      };
    case "mongodb":
      return {
        provider: "mongodb",
        credentials: {
          type: "mongodb",
          connectionString: kind.value.connectionString,
          ...(kind.value.database ? { database: kind.value.database } : {}),
          ...(kind.value.databases.length > 0
            ? { databases: [...kind.value.databases] }
            : {}),
        },
      };
    case "bigquery":
      return {
        provider: "bigquery",
        credentials: bigQueryCredentialsFromMessage(kind.value),
      };
    case "laminar":
      return {
        provider: "laminar",
        credentials: {
          type: "laminar",
          apiKey: kind.value.apiKey,
          ...(kind.value.apiBaseUrl
            ? { apiBaseUrl: kind.value.apiBaseUrl }
            : {}),
        },
      };
    case "awsAthenaConnector":
      return {
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
      };
    case "ga":
      return {
        provider: "ga",
        credentials: googleAnalyticsCredentialsFromMessage(kind.value),
      };
    case "amplitude":
      return {
        provider: "amplitude",
        credentials: {
          type: "amplitude",
          apiKey: kind.value.apiKey,
          region: amplitudeRegionFromMessage(kind.value.region) ?? "us",
          secretKey: kind.value.secretKey,
        },
      };
    case "mixpanel":
      return {
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
      };
    case "posthog":
      return {
        provider: "posthog",
        credentials: {
          type: "posthog",
          hostUrl: kind.value.hostUrl,
          personalApiKey: kind.value.personalApiKey,
          projectId: kind.value.projectId,
        },
      };
    case "sentry":
      return {
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
      };
    case "github":
      return {
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
      };
    case "linear":
      return {
        provider: "linear",
        credentials: linearCredentialsFromMessage(kind.value),
      };
    default:
      throwCliConnectError({
        detail: "source connect request must include typed credentials",
        key: "INVALID_REQUEST",
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
}): Credentials {
  switch (input.auth.case) {
    case "oauth": {
      const credentials = requirePresent(
        input.auth.value.credentials,
        "bigquery oauth credentials are required"
      );
      return {
        type: "bigquery",
        projectId: input.auth.value.projectId,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: numberFromUInt64(
          credentials.expiresAt,
          "bigquery.expiresAt"
        ),
      };
    }
    case "serviceAccount":
      return {
        type: "bigquery",
        authType: "service_account",
        projectId: input.auth.value.projectId,
        serviceAccount: serviceAccountCredentialsFromMessage(
          requirePresent(
            input.auth.value.serviceAccount,
            "bigquery service account credentials are required"
          )
        ),
      };
    default:
      throwCliConnectError({
        detail: "bigquery credentials must choose one auth mode",
        key: "INVALID_REQUEST",
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
}): Credentials {
  switch (input.auth.case) {
    case "oauth": {
      const credentials = requirePresent(
        input.auth.value.credentials,
        "google analytics oauth credentials are required"
      );
      return {
        type: "ga",
        propertyId: input.auth.value.propertyId,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: numberFromUInt64(credentials.expiresAt, "ga.expiresAt"),
      };
    }
    case "serviceAccount":
      return {
        type: "ga",
        authType: "service_account",
        propertyId: input.auth.value.propertyId,
        serviceAccount: serviceAccountCredentialsFromMessage(
          requirePresent(
            input.auth.value.serviceAccount,
            "google analytics service account credentials are required"
          )
        ),
      };
    default:
      throwCliConnectError({
        detail: "google analytics credentials must choose one auth mode",
        key: "INVALID_REQUEST",
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
}): Credentials {
  switch (input.auth.case) {
    case "apiKey":
      return {
        type: "linear",
        apiKey: input.auth.value.apiKey,
      };
    case "oauth":
      return {
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
      };
    default:
      throwCliConnectError({
        detail: "linear credentials must choose one auth mode",
        key: "INVALID_REQUEST",
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

function requirePresent<T>(value: T | undefined, detail: string): T {
  if (value !== undefined) {
    return value;
  }

  throwCliConnectError({
    detail,
    key: "INVALID_REQUEST",
  });
}

function numberFromUInt64(value: bigint, field: string) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throwCliConnectError({
      detail: `${field} exceeds the supported numeric range`,
      key: "INVALID_REQUEST",
    });
  }

  return Number(value);
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
