import type { JsonObject, MessageInitShape } from "@bufbuild/protobuf";
import type { DataSourceStatus, ProviderType } from "@onequery/db/server";
import { CreateDataSourceSchema } from "@onequery/server/routes/data-sources/schemas";
import { ensureConnectorOrganization } from "@onequery/server/services/connectors/broker";

import { isCliSourceKey } from "../../identifiers";
import { buildCliRequestLogDetails, logCliEvent } from "../../observability";
import type { CliSelectedFields } from "../../read-controls-policy";
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
import { projectCliSourceSummary } from "../../transport/source-response";
import { requireCliConnectRequestContext } from "../context";
import { throwCliConnectError } from "../error";
import {
  CliSourceProvider,
  CliSourceStatus,
  ConnectSourceResponseSchema,
  GetSourceResponseSchema,
  GetSourceConnectGuideResponseSchema,
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
import {
  buildCliPage,
  parseCliFieldsReadControls,
  parseCliPaginatedReadControls,
} from "./read-controls";
import type { CliServiceMethod } from "./types";

const SOURCE_FIELDS = [
  "name",
  "displayName",
  "provider",
  "queryable",
  "status",
] as const;

const SOURCE_LIST_FIELDS = [
  "sources",
  "sources.name",
  "sources.displayName",
  "sources.provider",
  "sources.queryable",
  "sources.status",
] as const;

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
  const readControls = parseCliPaginatedReadControls(request, {
    allowedFields: SOURCE_LIST_FIELDS,
  });
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
    sources: page.items.map((source) =>
      buildCliSourceSummaryMessage(
        source,
        readControls.selectedFields,
        "sources"
      )
    ),
    page: buildCliPage(page.page),
  };
};

export const handleGetSource: CliServiceMethod<"getSource"> = async (
  request,
  context
) => {
  const requestContext = requireCliConnectRequestContext(context);
  const c = requestContext.honoContext;
  const readControls = parseCliFieldsReadControls(request, {
    allowedFields: SOURCE_FIELDS,
  });
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

  return buildCliSourceSummaryMessage(
    summary,
    readControls.selectedFields
  ) satisfies MessageInitShape<typeof GetSourceResponseSchema>;
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

  return buildCliSourceConnectGuideMessage(guide);
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
  const provider = fromCliSourceProvider(request.source);

  if (!isCliSourceKey(request.name)) {
    throwCliConnectError({
      detail:
        "source name must use only letters, numbers, dots, underscores, or hyphens",
      key: "INVALID_REQUEST",
    });
  }

  const parsed = CreateDataSourceSchema.safeParse({
    credentials: request.credentials,
    name: request.name,
    organizationId: authorizedOrg.org.id,
    provider,
  });
  if (!parsed.success) {
    throwCliConnectSourceValidationError(parsed.error);
  }

  if (
    !doesProviderMatchCredentials({
      credentialsType: parsed.data.credentials.type,
      provider: parsed.data.provider,
    })
  ) {
    throwCliConnectError({
      detail: `provider "${parsed.data.provider}" does not match credentials.type "${parsed.data.credentials.type}"`,
      key: "INVALID_REQUEST",
    });
  }

  if (
    parsed.data.provider === "aws_athena_connector" &&
    parsed.data.credentials.type === "aws_athena_connector"
  ) {
    const organizationCheck = await ensureConnectorOrganization({
      connectorId: parsed.data.credentials.connectorId,
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
      credentials: parsed.data.credentials,
      kind: "connect_source",
      name: parsed.data.name,
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

export function buildCliSourceSummaryMessage(
  source: {
    name?: string;
    displayName?: string | null;
    provider?: ProviderType;
    queryable?: boolean;
    status?: DataSourceStatus;
  },
  selectedFields: CliSelectedFields = null,
  scope: "source" | "sources" | null = null
): CliSourceSummaryMessage {
  const projected = projectCliSourceSummary(source, selectedFields, scope);
  const response: CliSourceSummaryMessage = {};

  if (projected.name !== undefined) {
    response.name = projected.name;
  }
  if (projected.displayName) {
    response.displayName = projected.displayName;
  }
  if (projected.provider !== undefined) {
    response.provider = toCliSourceProvider(projected.provider);
  }
  if (projected.queryable !== undefined) {
    response.queryable = projected.queryable;
  }
  if (projected.status !== undefined) {
    response.status = toCliSourceStatus(projected.status);
  }

  return response;
}

function buildCliSourceConnectGuideMessage(
  guide: ReturnType<typeof buildCliSourceConnectGuide>
): GetSourceConnectGuideResponseInit {
  return {
    title: guide.title,
    description: guide.description,
    format: toCliContentFormat(guide.format),
    content: guide.content,
    command: guide.command,
    inputSchema: {
      type: guide.inputSchema.type,
      required: [...guide.inputSchema.required],
      properties: {
        name: {
          type: guide.inputSchema.properties.name.type,
          description: guide.inputSchema.properties.name.description,
          ...(guide.inputSchema.properties.name.pattern
            ? { pattern: guide.inputSchema.properties.name.pattern }
            : {}),
          enumValues: [],
        },
        credentials: {
          type: guide.inputSchema.properties.credentials.type,
          description: guide.inputSchema.properties.credentials.description,
          enumValues: [],
        },
      },
    },
    providers: guide.providers.map((providerGuide) => ({
      provider: toCliSourceProvider(providerGuide.provider),
      summary: providerGuide.summary,
      requiredCredentialFields: [...providerGuide.requiredCredentialFields],
      optionalCredentialFields: [...providerGuide.optionalCredentialFields],
      steps: [...providerGuide.steps],
      credentialTemplate: providerGuide.credentialTemplate as JsonObject,
      exampleInput: providerGuide.exampleInput as JsonObject,
    })),
  };
}

function doesProviderMatchCredentials(input: {
  provider: ProviderType;
  credentialsType: string;
}) {
  if (input.provider === input.credentialsType) {
    return true;
  }

  return input.provider === "supabase" && input.credentialsType === "postgres";
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
