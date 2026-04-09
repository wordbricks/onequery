import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { prepareDataSourceCredentials } from "@onequery/server/services/data-source-credentials/prepare-data-source-credentials";
import {
  authorizeSourceApi,
  describeSourceApi,
  getSourceApiAdapter,
  normalizeSourceApiRequest,
  sourceApiRegistry,
} from "@onequery/server/source-api";
import type {
  PreparedSourceConnection,
  SourceApiActorContext,
} from "@onequery/server/source-api";

import type { AuthorizedCliOrgContext } from "../../authorization";
import type { CliSessionIdentity } from "../../domain/workflows";
import {
  buildCliRequestLogDetails,
  getCliLogLevelForStatus,
  logCliEvent,
  toCliErrorMessage,
} from "../../observability";
import { runCliLoadSourceEffect } from "../../source/effects";
import { requireCliConnectRequestContext } from "../context";
import {
  DescribeSourceApiResponseSchema,
  ExecuteSourceApiResponseSchema,
} from "../gen/onequery/cli/v1/source_api_pb";
import {
  fromCliExecuteSourceApiRequest,
  toCliDescribeSourceApiResponse,
  toCliExecuteSourceApiResponse,
} from "./conversions";
import { throwCliConnectSourceNotFound } from "./errors";
import type { CliHonoContext, CliServiceMethod } from "./types";

type DescribeSourceApiResponseInit = MessageInitShape<
  typeof DescribeSourceApiResponseSchema
>;
type ExecuteSourceApiResponseInit = MessageInitShape<
  typeof ExecuteSourceApiResponseSchema
>;

export const handleDescribeSourceApi: CliServiceMethod<
  "describeSourceApi"
> = async (request, context) => {
  const requestContext = requireCliConnectRequestContext(context);
  const c = requestContext.honoContext;
  const session = await requestContext.requireSession();
  const authorizedOrg = await requestContext.requireAuthorizedOrg({
    action: "source_api.describe",
    orgSlug: request.orgSlug,
    session,
  });
  const source = await requirePreparedCliSourceApiSource({
    authorizedOrg,
    c,
    sourceKey: request.sourceKey,
  });
  const actor = buildSourceApiActor({
    authorizedOrg,
    requestId: requestContext.requestId,
    session,
  });
  const descriptor = await describeSourceApi({
    actor,
    source,
  });

  logCliEvent({
    details: buildCliRequestLogDetails(c, {
      operationCount: descriptor.operations.length,
      orgSlug: authorizedOrg.org.slug,
      provider: descriptor.source.provider,
      roles: authorizedOrg.membershipRoles,
      sourceKey: descriptor.source.key,
    }),
    event: "source_api.describe.resolved",
    level: "info",
  });

  return toCliDescribeSourceApiResponse(
    descriptor
  ) satisfies DescribeSourceApiResponseInit;
};

export const handleExecuteSourceApi: CliServiceMethod<
  "executeSourceApi"
> = async (request, context) => {
  const requestContext = requireCliConnectRequestContext(context);
  const c = requestContext.honoContext;
  const session = await requestContext.requireSession();
  const authorizedOrg = await requestContext.requireAuthorizedOrg({
    action: "source_api.execute",
    orgSlug: request.orgSlug,
    session,
  });
  const source = await requirePreparedCliSourceApiSource({
    authorizedOrg,
    c,
    sourceKey: request.sourceKey,
  });
  const actor = buildSourceApiActor({
    authorizedOrg,
    requestId: requestContext.requestId,
    session,
  });
  const descriptor = await describeSourceApi({
    actor,
    source,
  });
  const normalizedRequest = fromCliExecuteSourceApiRequest(request);
  const plan = await Promise.resolve()
    .then(() =>
      normalizeSourceApiRequest({
        actor,
        descriptor,
        request: normalizedRequest,
        source,
      })
    )
    .catch((error: unknown) => {
      throw toSourceApiRequestConnectError(error);
    });

  await Promise.resolve()
    .then(() =>
      authorizeSourceApi({
        actor,
        plan,
      })
    )
    .catch((error: unknown) => {
      throw new ConnectError(toCliErrorMessage(error), Code.PermissionDenied);
    });

  const response = await getSourceApiAdapter(
    sourceApiRegistry,
    source.provider
  ).execute({
    actor,
    plan,
    source,
  });

  logCliEvent({
    details: buildCliRequestLogDetails(c, {
      operation: response.operation,
      orgSlug: authorizedOrg.org.slug,
      provider: response.source.provider,
      roles: authorizedOrg.membershipRoles,
      sourceKey: response.source.key,
      status: response.status,
    }),
    event: "source_api.execute.resolved",
    level: getCliLogLevelForStatus(response.status),
  });

  return toCliExecuteSourceApiResponse(
    response
  ) satisfies ExecuteSourceApiResponseInit;
};

function buildSourceApiActor(input: {
  authorizedOrg: AuthorizedCliOrgContext;
  requestId: string;
  session: CliSessionIdentity;
}): SourceApiActorContext {
  return {
    capabilities: input.authorizedOrg.capabilities,
    membershipRoles: input.authorizedOrg.membershipRoles,
    organizationId: input.authorizedOrg.org.id,
    organizationSlug: input.authorizedOrg.org.slug,
    requestId: input.requestId,
    userId: input.session.user.id,
  };
}

async function requirePreparedCliSourceApiSource(input: {
  authorizedOrg: AuthorizedCliOrgContext;
  c: CliHonoContext;
  sourceKey: string;
}): Promise<PreparedSourceConnection> {
  const source = await runCliLoadSourceEffect({
    db: input.c.var.storage.db,
    effect: {
      kind: "load_source",
      organizationId: input.authorizedOrg.org.id,
      sourceKey: input.sourceKey,
    },
  });

  if (source.kind === "not_found") {
    throwCliConnectSourceNotFound(
      input.authorizedOrg.org.slug,
      input.sourceKey
    );
  }

  const credentials = await prepareDataSourceCredentials({
    dataSource: source.source,
    masterEncryptionKey: input.c.var.runtime.crypto.masterEncryptionKey,
  });
  if (!credentials.ok) {
    throw new ConnectError(credentials.error, Code.FailedPrecondition);
  }

  return {
    credentials: credentials.value.credentials,
    displayName: source.source.displayName,
    id: source.source.id,
    provider: source.source.provider,
    sourceKey: source.source.sourceKey,
  };
}

function toSourceApiRequestConnectError(error: unknown) {
  const detail = toCliErrorMessage(error);
  if (detail.startsWith("descriptor_version mismatch:")) {
    return new ConnectError(detail, Code.FailedPrecondition);
  }

  return new ConnectError(detail, Code.InvalidArgument);
}
