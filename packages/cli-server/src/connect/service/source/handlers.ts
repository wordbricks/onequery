import { safeValidateCredentials } from "@onequery/db/server";
import { ensureConnectorOrganization } from "@onequery/server/services/connectors/broker";
import { Result } from "better-result";

import type {
  AuthorizedCliOrgContext,
  CliAction,
} from "../../../authorization";
import { buildCliRequestLogDetails, logCliEvent } from "../../../observability";
import { paginateItems } from "../../../read-controls-policy";
import {
  buildCliSourceConnectGuide,
  buildCliSourceConnectResult,
} from "../../../source/connect";
import {
  runCliConnectSourceEffect,
  runCliListSourcesEffect,
  runCliLoadSourceEffect,
  runCliTestSourceEffect,
} from "../../../source/effects";
import {
  getCliSourceInterfaceTypes,
  sortCliSourceRecords,
} from "../../../source/model";
import { requireCliConnectRequestContext } from "../../context";
import {
  createCliSourceNameConflictFailure,
  createCliSourceNotFoundFailure,
} from "../errors";
import { buildCliPage, parseCliPageRequest } from "../read-controls";
import type { CliResultServiceMethod, CliServiceResult } from "../result";
import { cliServiceErr, liftCliServiceMethod } from "../result";
import { fromCliSourceProvider } from "../source-provider";
import type { CliHonoContext, CliServiceMethod } from "../types";
import {
  createCliConnectSourceValidationError,
  parseConnectSourceCredentials,
} from "./credentials";
import {
  buildCliSource,
  buildGetSourceResponse,
  buildTestSourceResponse,
  toCliContentFormat,
} from "./response";
import type {
  ConnectSourceResponseInit,
  GetSourceConnectGuideResponseInit,
  TestSourceResponseInit,
} from "./types";

const handleListSourcesImpl: CliResultServiceMethod<"listSources"> = async (
  request,
  context
) =>
  Result.gen(async function* handleListSourcesFlow() {
    const access = yield* Result.await(
      resolveAuthorizedSourceRequestState(
        "source.list",
        request.orgSlug,
        context
      )
    );
    const readControls = yield* parseCliPageRequest({
      invalidRequestKey: "SOURCE_REQUEST_INVALID",
      page: request.page,
    });
    const sources = await runCliListSourcesEffect({
      db: access.c.var.storage.db,
      effect: {
        kind: "list_sources",
        organizationId: access.authorizedOrg.org.id,
      },
    });
    const sortedSources = sortCliSourceRecords(sources.sources);
    const page = paginateItems(sortedSources, readControls);

    logCliEvent({
      details: buildCliRequestLogDetails(access.c, {
        orgSlug: access.authorizedOrg.org.slug,
        roles: access.authorizedOrg.membershipRoles,
        sourceCount: sortedSources.length,
      }),
      event: "source.list.resolved",
      level: "info",
    });

    return Result.ok({
      sources: page.items.map(buildCliSource),
      page: buildCliPage(page.page),
    });
  });

const handleGetSourceImpl: CliResultServiceMethod<"getSource"> = async (
  request,
  context
) =>
  Result.gen(async function* handleGetSourceFlow() {
    const access = yield* Result.await(
      resolveAuthorizedSourceRequestState(
        "source.read",
        request.orgSlug,
        context
      )
    );
    const source = await runCliLoadSourceEffect({
      db: access.c.var.storage.db,
      effect: {
        kind: "load_source",
        organizationId: access.authorizedOrg.org.id,
        sourceKey: request.sourceKey,
      },
    });

    if (source.kind === "not_found") {
      logCliEvent({
        details: buildCliRequestLogDetails(access.c, {
          orgSlug: access.authorizedOrg.org.slug,
          roles: access.authorizedOrg.membershipRoles,
          sourceKey: request.sourceKey,
        }),
        event: "source.lookup.not_found",
        level: "warn",
      });

      return Result.err(
        createCliSourceNotFoundFailure(
          access.authorizedOrg.org.slug,
          request.sourceKey
        )
      );
    }

    const interfaces = getCliSourceInterfaceTypes(
      source.source.provider,
      source.source.status
    );

    logCliEvent({
      details: buildCliRequestLogDetails(access.c, {
        orgSlug: access.authorizedOrg.org.slug,
        roles: access.authorizedOrg.membershipRoles,
        sourceKey: request.sourceKey,
        provider: source.source.provider,
        interfaces,
      }),
      event: "source.lookup.resolved",
      level: "info",
    });

    return Result.ok(buildGetSourceResponse(source.source));
  });

const handleTestSourceImpl: CliResultServiceMethod<"testSource"> = async (
  request,
  context
) =>
  Result.gen(async function* handleTestSourceFlow() {
    const access = yield* Result.await(
      resolveAuthorizedSourceRequestState(
        "source.read",
        request.orgSlug,
        context
      )
    );
    const source = await runCliLoadSourceEffect({
      db: access.c.var.storage.db,
      effect: {
        kind: "load_source",
        organizationId: access.authorizedOrg.org.id,
        sourceKey: request.sourceKey,
      },
    });

    if (source.kind === "not_found") {
      logCliEvent({
        details: buildCliRequestLogDetails(access.c, {
          orgSlug: access.authorizedOrg.org.slug,
          roles: access.authorizedOrg.membershipRoles,
          sourceKey: request.sourceKey,
        }),
        event: "source.test.not_found",
        level: "warn",
      });

      return Result.err(
        createCliSourceNotFoundFailure(
          access.authorizedOrg.org.slug,
          request.sourceKey
        )
      );
    }

    const outcome = await runCliTestSourceEffect({
      db: access.c.var.storage.db,
      effect: {
        kind: "test_source",
        organizationId: access.authorizedOrg.org.id,
        source: source.source,
      },
      masterEncryptionKey: access.c.var.runtime.crypto.masterEncryptionKey,
    });

    logCliEvent({
      details: buildCliRequestLogDetails(access.c, {
        orgSlug: access.authorizedOrg.org.slug,
        provider: source.source.provider,
        roles: access.authorizedOrg.membershipRoles,
        sourceKey: request.sourceKey,
        success: outcome.kind === "supported" ? outcome.success : "unsupported",
      }),
      event: "source.test.completed",
      level: outcome.kind === "supported" && !outcome.success ? "warn" : "info",
    });

    return Result.ok(
      buildTestSourceResponse({
        outcome,
        source: source.source,
      }) satisfies TestSourceResponseInit
    );
  });

const handleGetSourceConnectGuideImpl: CliResultServiceMethod<
  "getSourceConnectGuide"
> = async (request, context) =>
  Result.gen(async function* handleGetSourceConnectGuideFlow() {
    const access = yield* Result.await(
      resolveAuthorizedSourceRequestState(
        "source.connect",
        request.orgSlug,
        context
      )
    );
    const provider = yield* fromCliSourceProvider(request.provider);
    const guide = buildCliSourceConnectGuide(provider);

    logCliEvent({
      details: buildCliRequestLogDetails(access.c, {
        orgSlug: access.authorizedOrg.org.slug,
        provider,
        roles: access.authorizedOrg.membershipRoles,
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
    const access = yield* Result.await(
      resolveAuthorizedSourceRequestState(
        "source.connect",
        request.orgSlug,
        context
      )
    );
    const { credentials, provider } = yield* parseConnectSourceCredentials(
      request.credentials
    );
    const parsedCredentials = safeValidateCredentials(credentials);
    if (!parsedCredentials.success) {
      return createCliConnectSourceValidationError(parsedCredentials.error);
    }

    if (
      credentials.type === "aws_athena_connector" &&
      parsedCredentials.data.type === "aws_athena_connector"
    ) {
      const organizationCheck = await ensureConnectorOrganization({
        connectorId: parsedCredentials.data.connectorId,
        db: access.c.var.storage.db,
        organizationId: access.authorizedOrg.org.id,
      });
      if (organizationCheck.isErr()) {
        return cliServiceErr({
          detail: organizationCheck.error.message,
          key: "SOURCE_REQUEST_INVALID",
        });
      }
    }

    const result = await runCliConnectSourceEffect({
      db: access.c.var.storage.db,
      effect: {
        credentials: parsedCredentials.data,
        kind: "connect_source",
        name: request.sourceKey,
        organizationId: access.authorizedOrg.org.id,
        provider,
      },
      masterEncryptionKey: access.c.var.runtime.crypto.masterEncryptionKey,
    });
    if (result.kind === "name_conflict") {
      return Result.err(
        createCliSourceNameConflictFailure(
          access.authorizedOrg.org.slug,
          result.sourceName
        )
      );
    }

    const response = buildCliSourceConnectResult(result.source);

    logCliEvent({
      details: buildCliRequestLogDetails(access.c, {
        orgSlug: access.authorizedOrg.org.slug,
        provider: response.source.provider,
        roles: access.authorizedOrg.membershipRoles,
        sourceName: response.source.sourceKey,
      }),
      event: "source.connect.created",
      level: "info",
    });

    return Result.ok({
      nextCommand: response.nextCommand,
      source: buildCliSource(response.source),
    } satisfies ConnectSourceResponseInit);
  });

export const handleListSources = liftCliServiceMethod(handleListSourcesImpl);

export const handleGetSource = liftCliServiceMethod(handleGetSourceImpl);

export const handleTestSource = liftCliServiceMethod(handleTestSourceImpl);

export const handleGetSourceConnectGuide = liftCliServiceMethod(
  handleGetSourceConnectGuideImpl
);

export const handleConnectSource = liftCliServiceMethod(
  handleConnectSourceImpl
);

async function resolveAuthorizedSourceRequestState(
  action: CliAction,
  orgSlug: string,
  context: Parameters<CliServiceMethod<"listSources">>[1]
): Promise<
  CliServiceResult<{
    authorizedOrg: AuthorizedCliOrgContext;
    c: CliHonoContext;
  }>
> {
  return Result.gen(async function* resolveAuthorizedSourceRequestStateFlow() {
    const requestContext = requireCliConnectRequestContext(context);
    const authorizedOrg = yield* Result.await(
      requestContext.resolveAuthorizedOrg({
        action,
        orgSlug,
      })
    );

    return Result.ok({
      authorizedOrg,
      c: requestContext.honoContext,
    });
  });
}
