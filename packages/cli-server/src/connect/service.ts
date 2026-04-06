import type { JsonObject, MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ServiceImpl } from "@connectrpc/connect";
import { and, eq, getDatabaseSchema } from "@onequery/db/server";
import type { DataSourceStatus, ProviderType } from "@onequery/db/server";
import { CreateDataSourceSchema } from "@onequery/server/routes/data-sources/schemas";
import { ensureConnectorOrganization } from "@onequery/server/services/connectors/broker";

import {
  createAuthProxyRequest,
  createBearerHeaders,
  readBetterAuthDeviceCodeResponse,
  readBetterAuthDeviceTokenErrorResponse,
  readBetterAuthDeviceTokenSuccessResponse,
  throwCliLoginRateLimitedProblem,
  toCliDeviceAuthProblemDetail,
} from "../auth/device-transport";
import {
  refreshCliSessionIdentity,
  resolveCliSessionIdentity,
} from "../auth/session-identity";
import { authorizeCliOrgAccess } from "../authorization";
import type { CliAction, AuthorizedCliOrgContext } from "../authorization";
import {
  CLI_DEFAULT_LOGIN_TIMEOUT_SEC,
  CLI_DEFAULT_POLL_AFTER_MS,
  CLI_DEVICE_AUTH_CLIENT_ID,
  CLI_DEVICE_AUTH_CODE_PATH,
  CLI_DEVICE_AUTH_GRANT_TYPE,
  CLI_DEVICE_AUTH_TOKEN_PATH,
  deviceAuthorizationPollAfterMs,
  slowedDeviceAuthorizationPollAfterMs,
} from "../cli-defaults";
import type { CliApiErrorStage } from "../domain/problems";
import type { CliSessionIdentity } from "../domain/workflows";
import { toCliAuthUserView } from "../domain/workflows";
import { throwCliProblem, getCliRequestId } from "../error";
import { isCliSourceKey } from "../identifiers";
import {
  buildCliRequestLogDetails,
  logCliEvent,
  recordCliCounterMetric,
  recordCliHistogramMetric,
  toCliErrorMessage,
} from "../observability";
import {
  runCliListVisibleOrgs,
  runCliLoadOrgAccess,
} from "../organization/effects";
import { finishCliOrgAccessWorkflow } from "../organization/workflow";
import {
  runCliExecuteSqlEffect,
  runCliLoadQueryCredentialsEffect,
  runCliPersistQueryUsageEffect,
  runCliValidateQueryEffect,
} from "../query/effects";
import {
  appendCliQueryActionTrailEvent,
  createCliQueryActionTrail,
} from "../query/logging";
import type { CliQueryActionTrailActor } from "../query/logging";
import {
  throwForCliQueryPlanResult,
  throwForCliQueryWorkflowResult,
} from "../query/model";
import {
  applyQueryResultWindow,
  resolveQueryResultWindow,
} from "../query/result-window";
import {
  runCliQueryExecutionWorkflow,
  runCliQueryValidationWorkflow,
} from "../query/workflow";
import type {
  CliQueryExecutionWorkflowResult,
  CliQueryValidationWorkflowResult,
} from "../query/workflow";
import {
  CLI_DEFAULT_PAGE_LIMIT,
  paginateItems,
  parsePageCursor,
  parseSelectedFields,
} from "../read-controls-policy";
import type {
  CliFieldsReadControls,
  CliPaginatedReadControls,
  CliSelectedFields,
} from "../read-controls-policy";
import {
  buildCliSourceConnectGuide,
  buildCliSourceConnectResult,
  sourceNameConflictProblem,
} from "../source/connect";
import {
  runCliConnectSourceEffect,
  runCliListSourcesEffect,
  runCliLoadSourceEffect,
} from "../source/effects";
import {
  buildCliSourceListResult,
  buildCliSourceSummary,
  sourceNotFoundProblem,
} from "../source/model";
import {
  buildCliSanitization,
  sanitizeCliRemoteText,
  sanitizeUndefinedableCliRemoteText,
} from "../transport/sanitization";
import { projectCliSourceSummary } from "../transport/source-response";
import {
  getCliUseIntegrationRequiredSkill,
  getCliUseSkill,
} from "../use/skills";
import type { CliUseSource as CliUseSkillSource } from "../use/skills";
import { throwCliValidationProblem } from "../validation";
import { requireCliConnectHonoContext } from "./context";
import { CliAuthMode } from "./gen/onequery/cli/v1/auth_pb";
import type { PollDeviceAuthorizationResponse } from "./gen/onequery/cli/v1/auth_pb";
import { CliService } from "./gen/onequery/cli/v1/cli_pb";
import { CliContentFormat } from "./gen/onequery/cli/v1/common_pb";
import { CliOrgCapability } from "./gen/onequery/cli/v1/org_pb";
import { CliQueryLogicalType } from "./gen/onequery/cli/v1/query_pb";
import type {
  ExecuteQueryResponse,
  ValidateQueryResponse,
} from "./gen/onequery/cli/v1/query_pb";
import {
  CliSourceProvider,
  CliSourceStatus,
} from "./gen/onequery/cli/v1/source_pb";
import { CliUseSource } from "./gen/onequery/cli/v1/use_pb";

const EMPTY_WARNINGS: string[] = [];

const SESSION_FIELDS = [
  "authMode",
  "user",
  "user.id",
  "user.email",
  "user.displayName",
  "activeOrgSlug",
  "issuedAt",
  "expiresAt",
] as const;

const ORG_LIST_FIELDS = [
  "organizations",
  "organizations.slug",
  "organizations.name",
] as const;

const ORG_FIELDS = ["slug", "name", "roles", "capabilities"] as const;

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

const QUERY_VALIDATE_FIELDS = [
  "request",
  "request.sql",
  "request.parameters",
  "request.maxRows",
  "request.maxBytes",
  "request.cellMaxChars",
  "request.timeoutMs",
  "normalizedSql",
  "declaredResultWindow",
  "declaredResultWindow.maxRows",
  "declaredResultWindow.maxBytes",
  "declaredResultWindow.cellMaxChars",
  "declaredResultWindow.timeoutMs",
  "source",
  "source.name",
  "source.displayName",
  "source.provider",
  "source.queryable",
  "source.status",
  "truncated",
] as const;

const QUERY_EXECUTE_FIELDS = [
  "source",
  "source.name",
  "source.displayName",
  "source.provider",
  "source.queryable",
  "source.status",
  "rowCount",
  "elapsedMs",
  "columns",
  "columns.name",
  "columns.logicalType",
  "rows",
  "truncated",
] as const;

type CliQueryValidationFailure = Exclude<
  CliQueryValidationWorkflowResult,
  { kind: "ready" }
>;

type CliQueryExecutionFailure = Exclude<
  CliQueryExecutionWorkflowResult,
  { kind: "response_ready" }
>;

type CliReadControlsConfig = {
  allowedFields: readonly string[];
  defaultStage: CliApiErrorStage;
  fieldStages?: Partial<Record<string, CliApiErrorStage>>;
  hint: string;
};

type CliPaginatedQueryInput = {
  fields?: string;
  limit?: number;
  cursor?: string;
};

export function createCliService(): Partial<ServiceImpl<typeof CliService>> {
  return {
    use: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const source = fromCliUseSource(request.source);
      const skill = await resolveCliUseSkill({
        c,
        source,
        orgSlug: request.orgSlug,
      });

      logCliEvent({
        details: buildCliRequestLogDetails(c, {
          orgSlug: skill.orgSlug,
          source,
        }),
        event: skill.event,
        level: "info",
      });

      return {
        requestId,
        warnings: EMPTY_WARNINGS,
        data: {
          source: toCliUseSourceEnum(skill.payload.source),
          title: skill.payload.title,
          description: skill.payload.description,
          format: toCliContentFormat(skill.payload.format),
          content: skill.payload.content,
        },
      };
    },

    getSession: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const readControls = parseCliFieldsReadControls(request, {
        allowedFields: SESSION_FIELDS,
        defaultStage: "auth",
        hint: "correct the read controls and retry",
      });
      const session = requireCliSessionIdentity(
        await resolveCliSessionIdentity(c.var.storage, c.req.raw.headers)
      );

      return {
        requestId,
        warnings: EMPTY_WARNINGS,
        data: projectCliSessionResponse(session, readControls.selectedFields),
      };
    },

    refreshSession: async (_request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const session = requireCliSessionIdentity(
        await refreshCliSessionIdentity(c.var.storage, c.req.raw.headers)
      );

      return {
        requestId,
        warnings: EMPTY_WARNINGS,
        data: buildCliRefreshSession(session),
      };
    },

    startDeviceAuthorization: async (_request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const response = await c.var.storage.auth.handler(
        createAuthProxyRequest(c.req.raw, CLI_DEVICE_AUTH_CODE_PATH, {
          client_id: CLI_DEVICE_AUTH_CLIENT_ID,
        })
      );

      if (response.status === 200) {
        const payload = await readBetterAuthDeviceCodeResponse(response);
        const expiresInSec =
          payload.expires_in ?? CLI_DEFAULT_LOGIN_TIMEOUT_SEC;

        return {
          requestId,
          warnings: EMPTY_WARNINGS,
          data: {
            state: "pending",
            deviceCode: payload.device_code,
            userCode: payload.user_code,
            ...buildDeviceVerificationUrls(
              c.var.runtime.auth.baseURL,
              payload.user_code
            ),
            pollAfterMs: deviceAuthorizationPollAfterMs(payload.interval),
            expiresAt: timestampFromDate(
              new Date(Date.now() + expiresInSec * 1000)
            ),
          },
        };
      }

      if (response.status === 400) {
        const payload = await readBetterAuthDeviceTokenErrorResponse(response);
        throwCliProblem({
          detail: toCliDeviceAuthProblemDetail(payload),
          key: "INVALID_REQUEST",
          stage: "auth",
        });
      }

      if (response.status === 429) {
        throwCliLoginRateLimitedProblem(
          response,
          "device authorization start was rate-limited"
        );
      }

      throw new Error(
        `unexpected Better Auth response for ${CLI_DEVICE_AUTH_CODE_PATH}: ${response.status}`
      );
    },

    pollDeviceAuthorization: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const response = await c.var.storage.auth.handler(
        createAuthProxyRequest(c.req.raw, CLI_DEVICE_AUTH_TOKEN_PATH, {
          client_id: CLI_DEVICE_AUTH_CLIENT_ID,
          device_code: request.deviceCode,
          grant_type: CLI_DEVICE_AUTH_GRANT_TYPE,
        })
      );

      if (response.status === 200) {
        const payload =
          await readBetterAuthDeviceTokenSuccessResponse(response);
        const session = await resolveCliSessionIdentity(
          c.var.storage,
          createBearerHeaders(c.req.raw, payload.access_token)
        );

        return {
          requestId,
          warnings: EMPTY_WARNINGS,
          outcome: {
            case: "authorized",
            value: buildAuthorizedDeviceAuthorizationResponse({
              accessToken: payload.access_token,
              session,
            }),
          },
        } satisfies MessageInitShape<typeof PollDeviceAuthorizationResponse>;
      }

      if (response.status === 400) {
        const payload = await readBetterAuthDeviceTokenErrorResponse(response);

        if (payload.error === "authorization_pending") {
          return {
            requestId,
            warnings: EMPTY_WARNINGS,
            outcome: {
              case: "pending",
              value: {
                state: "pending",
                pollAfterMs: CLI_DEFAULT_POLL_AFTER_MS,
              },
            },
          };
        }

        if (payload.error === "slow_down") {
          return {
            requestId,
            warnings: EMPTY_WARNINGS,
            outcome: {
              case: "pending",
              value: {
                state: "pending",
                pollAfterMs: slowedDeviceAuthorizationPollAfterMs(),
              },
            },
          };
        }

        if (payload.error === "access_denied") {
          throwCliProblem({
            detail:
              payload.error_description === undefined
                ? "device authorization was denied"
                : toCliDeviceAuthProblemDetail(payload),
            key: "LOGIN_DENIED",
          });
        }

        if (payload.error === "expired_token") {
          throwCliProblem({
            detail:
              payload.error_description === undefined
                ? "device authorization session expired"
                : toCliDeviceAuthProblemDetail(payload),
            key: "LOGIN_SESSION_EXPIRED",
          });
        }

        throwCliProblem({
          detail: toCliDeviceAuthProblemDetail(payload),
          key: "INVALID_REQUEST",
          stage: "auth",
        });
      }

      if (response.status === 429) {
        throwCliLoginRateLimitedProblem(
          response,
          "device authorization polling was rate-limited"
        );
      }

      throw new Error(
        `unexpected Better Auth response for ${CLI_DEVICE_AUTH_TOKEN_PATH}: ${response.status}`
      );
    },

    listOrganizations: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const readControls = parseCliPaginatedReadControls(request, {
        allowedFields: ORG_LIST_FIELDS,
        defaultStage: "auth",
        hint: "correct the read controls and retry",
      });
      const session = await requireAuthenticatedCliSession(c);
      const organizations = await runCliListVisibleOrgs({
        db: c.var.storage.db,
        userId: session.user.id,
      });
      const page = paginateItems(organizations, readControls);

      return {
        requestId,
        warnings: EMPTY_WARNINGS,
        data: {
          organizations: page.items.map((organization) =>
            projectCliOrganizationSummary(
              organization,
              readControls.selectedFields
            )
          ),
        },
        page: buildCliPage(page.page),
      };
    },

    getOrganization: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const readControls = parseCliFieldsReadControls(request, {
        allowedFields: ORG_FIELDS,
        defaultStage: "resolve_org",
        hint: "correct the read controls and retry",
      });
      const session = await requireAuthenticatedCliSession(c);
      const authorizedOrg = await requireAuthorizedCliOrg({
        action: "org.read",
        c,
        orgSlug: request.orgSlug,
        session,
      });

      return {
        requestId,
        warnings: EMPTY_WARNINGS,
        data: projectCliOrganizationDetails(
          authorizedOrg,
          readControls.selectedFields
        ),
      };
    },

    listSources: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const readControls = parseCliPaginatedReadControls(request, {
        allowedFields: SOURCE_LIST_FIELDS,
        defaultStage: "resolve_org",
        hint: "correct the read controls and retry",
      });
      const session = await requireAuthenticatedCliSession(c);
      const authorizedOrg = await requireAuthorizedCliOrg({
        action: "source.list",
        c,
        orgSlug: request.orgSlug,
        session,
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
        requestId,
        warnings: EMPTY_WARNINGS,
        data: {
          sources: page.items.map((source) =>
            projectCliSourceSummaryMessage(
              source,
              readControls.selectedFields,
              "sources"
            )
          ),
        },
        page: buildCliPage(page.page),
      };
    },

    getSource: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const readControls = parseCliFieldsReadControls(request, {
        allowedFields: SOURCE_FIELDS,
        defaultStage: "resolve_source",
        hint: "correct the read controls and retry",
      });
      const session = await requireAuthenticatedCliSession(c);
      const authorizedOrg = await requireAuthorizedCliOrg({
        action: "source.read",
        c,
        orgSlug: request.orgSlug,
        session,
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
        throw sourceNotFoundProblem(authorizedOrg.org.slug, request.sourceKey);
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

      return {
        requestId,
        warnings: EMPTY_WARNINGS,
        data: projectCliSourceSummaryMessage(
          summary,
          readControls.selectedFields
        ),
      };
    },

    getSourceConnectGuide: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const session = await requireAuthenticatedCliSession(c);
      const authorizedOrg = await requireAuthorizedCliOrg({
        action: "source.connect",
        c,
        orgSlug: request.orgSlug,
        session,
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
        requestId,
        warnings: EMPTY_WARNINGS,
        data: buildCliSourceConnectGuideMessage(guide),
      };
    },

    connectSource: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const session = await requireAuthenticatedCliSession(c);
      const authorizedOrg = await requireAuthorizedCliOrg({
        action: "source.connect",
        c,
        orgSlug: request.orgSlug,
        session,
      });
      const provider = fromCliSourceProvider(request.source);

      if (!isCliSourceKey(request.name)) {
        throwCliProblem({
          detail:
            "source name must use only letters, numbers, dots, underscores, or hyphens",
          hint: "rename the source and retry",
          key: "INVALID_REQUEST",
          stage: "resolve_source",
        });
      }

      const parsed = CreateDataSourceSchema.safeParse({
        credentials: request.credentials,
        name: request.name,
        organizationId: authorizedOrg.org.id,
        provider,
      });
      if (!parsed.success) {
        throwCliValidationProblem({
          config: {
            defaultMessage: "invalid source connect request",
            defaultStage: "resolve_source",
            fieldStages: {
              credentials: "resolve_source",
              name: "resolve_source",
              organizationId: "resolve_org",
            },
            hint: "correct the request body and retry",
          },
          result: {
            data: request,
            error: parsed.error,
            success: false,
            target: "json",
          },
        });
      }

      if (
        !doesProviderMatchCredentials({
          credentialsType: parsed.data.credentials.type,
          provider: parsed.data.provider,
        })
      ) {
        throwCliProblem({
          detail: `provider "${parsed.data.provider}" does not match credentials.type "${parsed.data.credentials.type}"`,
          hint: "align provider and credentials.type, then retry",
          key: "INVALID_REQUEST",
          stage: "resolve_source",
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
          throwCliProblem({
            detail: organizationCheck.error,
            hint: "correct the connector reference and retry",
            key: "INVALID_REQUEST",
            stage: "resolve_source",
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
        throw sourceNameConflictProblem(
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
        requestId,
        warnings: EMPTY_WARNINGS,
        data: {
          nextCommand: response.nextCommand,
          source: buildCliSourceSummaryMessage(response.source),
        },
      };
    },

    validateQuery: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const readControls = parseCliFieldsReadControls(request, {
        allowedFields: QUERY_VALIDATE_FIELDS,
        defaultStage: "read_query_input",
        hint: "correct the read controls and retry",
      });
      const session = await requireAuthenticatedCliSession(c);
      const authorizedOrg = await requireAuthorizedCliOrg({
        action: "query.execute",
        c,
        orgSlug: request.orgSlug,
        session,
      });
      const query = request.query as NonNullable<typeof request.query>;

      throwIfCliQueryParametersProvided(query.parameters);

      const resultWindow = resolveQueryResultWindow(query);
      const actionId = (
        await createCliQueryActionTrail({
          actionType: "validate",
          actor: buildCliQueryActionTrailActor({
            authorizedOrg,
            session,
          }),
          cellMaxChars: resultWindow.cellMaxChars,
          db: c.var.storage.db,
          maxBytes: resultWindow.maxBytes,
          maxRows: resultWindow.maxRows,
          organizationId: authorizedOrg.org.id,
          requestId,
          sourceKey: request.sourceKey,
          sql: query.sql,
          timeoutMs: resultWindow.timeoutMs,
        }).catch((error) => {
          logCliQueryActionTrailFailure({
            actionType: "validate",
            c,
            error,
            operation: "create",
            sourceKey: request.sourceKey,
          });
          throwCliQueryActionTrailFailure({
            actionType: "validate",
            operation: "create",
            sourceKey: request.sourceKey,
          });
        })
      ).actionId;

      const result = await runCliQueryValidationWorkflow({
        dispatch: {
          loadSource: async (effect) =>
            runCliLoadSourceEffect({
              db: c.var.storage.db,
              effect,
            }),
          validateQuery: runCliValidateQueryEffect,
        },
        org: authorizedOrg.org,
        requestId,
        sourceName: request.sourceKey,
        sql: query.sql,
        timeoutMs: resultWindow.timeoutMs,
        observeEvent: async (event) => {
          await appendCliQueryActionTrailEvent({
            actionId,
            db: c.var.storage.db,
            event,
          });
        },
        observeEventFailure: async ({ error, event }) => {
          logCliQueryActionTrailFailure({
            actionType: "validate",
            c,
            error,
            eventType: event.type,
            operation: "append",
            sourceKey: request.sourceKey,
          });
          throwCliQueryActionTrailFailure({
            actionType: "validate",
            eventType: event.type,
            operation: "append",
            sourceKey: request.sourceKey,
          });
        },
      });

      if (result.kind !== "ready") {
        logCliQueryValidationFailure(c, request.sourceKey, result);
        throwForCliQueryPlanResult(result);
      }

      logCliQueryValidationAccepted({
        c,
        provider: result.source.provider,
        sourceKey: request.sourceKey,
        truncated: result.truncated,
      });

      return {
        requestId,
        warnings: EMPTY_WARNINGS,
        data: buildQueryValidateResponse(
          {
            request: {
              sql: result.normalizedSql,
              parameters: [],
              maxRows: resultWindow.maxRows,
              maxBytes: resultWindow.maxBytes,
              cellMaxChars: resultWindow.cellMaxChars,
              timeoutMs: resultWindow.timeoutMs,
            },
            normalizedSql: result.normalizedSql,
            declaredResultWindow: {
              maxRows: resultWindow.maxRows,
              maxBytes: resultWindow.maxBytes,
              cellMaxChars: resultWindow.cellMaxChars,
              timeoutMs: resultWindow.timeoutMs,
            },
            source: buildCliSourceSummary(result.source),
            truncated: result.truncated,
          },
          readControls.selectedFields
        ),
      } satisfies MessageInitShape<typeof ValidateQueryResponse>;
    },

    executeQuery: async (request, context) => {
      const c = requireCliConnectHonoContext(context);
      const requestId = getCliRequestId(c);
      const readControls = parseCliPaginatedReadControls(request, {
        allowedFields: QUERY_EXECUTE_FIELDS,
        defaultStage: "read_query_input",
        hint: "correct the read controls and retry",
      });
      const session = await requireAuthenticatedCliSession(c);
      const authorizedOrg = await requireAuthorizedCliOrg({
        action: "query.execute",
        c,
        orgSlug: request.orgSlug,
        session,
      });
      const query = request.query as NonNullable<typeof request.query>;

      throwIfCliQueryParametersProvided(query.parameters);

      const resultWindow = resolveQueryResultWindow(query);
      const startedAtMs = Date.now();
      const actionId = (
        await createCliQueryActionTrail({
          actionType: "execute",
          actor: buildCliQueryActionTrailActor({
            authorizedOrg,
            session,
          }),
          cellMaxChars: resultWindow.cellMaxChars,
          db: c.var.storage.db,
          maxBytes: resultWindow.maxBytes,
          maxRows: resultWindow.maxRows,
          organizationId: authorizedOrg.org.id,
          requestId,
          sourceKey: request.sourceKey,
          sql: query.sql,
          timeoutMs: resultWindow.timeoutMs,
        }).catch((error) => {
          logCliQueryActionTrailFailure({
            actionType: "execute",
            c,
            error,
            operation: "create",
            sourceKey: request.sourceKey,
          });
          throwCliQueryActionTrailFailure({
            actionType: "execute",
            operation: "create",
            sourceKey: request.sourceKey,
          });
        })
      ).actionId;

      const result = await runCliQueryExecutionWorkflow({
        dispatch: {
          loadSource: async (effect) =>
            runCliLoadSourceEffect({
              db: c.var.storage.db,
              effect,
            }),
          validateQuery: runCliValidateQueryEffect,
          loadCredentials: async (effect) =>
            runCliLoadQueryCredentialsEffect({
              db: c.var.storage.db,
              masterEncryptionKey: c.var.runtime.crypto.masterEncryptionKey,
              effect,
            }),
          executeSql: async (effect) =>
            runCliExecuteSqlEffect({
              db: c.var.storage.db,
              effect,
            }),
          persistUsage: async (effect) =>
            runCliPersistQueryUsageEffect({
              db: c.var.storage.db,
              effect,
            }),
        },
        org: authorizedOrg.org,
        requestId,
        sourceName: request.sourceKey,
        sql: query.sql,
        timeoutMs: resultWindow.timeoutMs,
        observeEvent: async (event) => {
          await appendCliQueryActionTrailEvent({
            actionId,
            db: c.var.storage.db,
            event,
          });
        },
        observeEventFailure: async ({ error, event }) => {
          logCliQueryActionTrailFailure({
            actionType: "execute",
            c,
            error,
            eventType: event.type,
            operation: "append",
            sourceKey: request.sourceKey,
          });
          throwCliQueryActionTrailFailure({
            actionType: "execute",
            eventType: event.type,
            operation: "append",
            sourceKey: request.sourceKey,
          });
        },
      });
      const durationMs = Math.max(0, Date.now() - startedAtMs);

      recordCliHistogramMetric({
        name: "cli.query.latency_ms",
        tags: {
          outcome: result.kind === "response_ready" ? "succeeded" : result.kind,
        },
        value: durationMs,
      });

      if (result.kind !== "response_ready") {
        logCliQueryExecutionFailure({
          c,
          durationMs,
          result,
          sourceKey: request.sourceKey,
        });
        throwForCliQueryWorkflowResult(result);
      }

      const windowedRows = applyQueryResultWindow({
        cellMaxChars: resultWindow.cellMaxChars,
        maxBytes: resultWindow.maxBytes,
        maxRows: resultWindow.maxRows,
        rows: result.response.rows,
      });
      const windowedResponse = {
        ...result.response,
        rows: windowedRows.rows,
        truncated: result.response.truncated || windowedRows.truncated,
      };

      logCliQueryExecutionSuccess({
        c,
        durationMs,
        response: windowedResponse,
        sourceKey: request.sourceKey,
        usagePersistence: result.usagePersistence,
      });

      const page = paginateItems(windowedResponse.rows, readControls);
      const data = buildQueryExecuteResponse(
        {
          columns: windowedResponse.columns,
          elapsedMs: windowedResponse.elapsedMs,
          rowCount: windowedResponse.rowCount,
          rows: page.items,
          source: windowedResponse.source,
          truncated: windowedResponse.truncated,
        },
        readControls.selectedFields
      );
      const untrustedPaths = resolveQueryExecuteUntrustedPaths(
        readControls.selectedFields,
        page.items.length > 0
      );

      return {
        requestId,
        warnings: EMPTY_WARNINGS,
        data: sanitizeQueryExecuteResponse(data),
        page: buildCliPage(page.page),
        untrustedPaths: untrustedPaths ?? [],
        sanitization: buildCliSanitization(untrustedPaths),
      } satisfies MessageInitShape<typeof ExecuteQueryResponse>;
    },
  };
}

function requireCliSessionIdentity(
  session: CliSessionIdentity | null
): CliSessionIdentity {
  if (session) {
    return session;
  }

  throwCliProblem({
    detail: "no authenticated session was found",
    key: "NOT_LOGGED_IN",
  });
}

async function requireAuthenticatedCliSession(
  c: Parameters<typeof buildCliRequestLogDetails>[0]
) {
  const session = await resolveCliSessionIdentity(
    c.var.storage,
    c.req.raw.headers
  );
  if (!session) {
    logCliEvent({
      details: buildCliRequestLogDetails(c),
      event: "auth.session_missing",
      level: "warn",
    });
    throwCliProblem({
      detail: "no authenticated session was found",
      key: "NOT_LOGGED_IN",
    });
  }

  return session;
}

async function requireAuthorizedCliOrg(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  session: CliSessionIdentity;
  orgSlug: string;
  action: CliAction;
}): Promise<AuthorizedCliOrgContext> {
  const decision = finishCliOrgAccessWorkflow({
    access: await runCliLoadOrgAccess({
      db: input.c.var.storage.db,
      orgSlug: input.orgSlug,
      userId: input.session.user.id,
    }),
    orgSlug: input.orgSlug,
  });

  if (decision.kind !== "allowed") {
    recordCliCounterMetric({
      name: "cli.org.resolution_failure_total",
      tags: {
        reason: decision.kind,
      },
    });
    logCliEvent({
      details: buildCliRequestLogDetails(input.c, {
        action: input.action,
        orgSlug: input.orgSlug,
        reason: decision.kind,
        userId: input.session.user.id,
      }),
      event: "org.access_denied",
      level: "warn",
    });
    interpretCliOrgAccessState(decision);
  }

  const authorization = authorizeCliOrgAccess({
    action: input.action,
    org: decision.org,
    rawMembershipRole: decision.rawMembershipRole,
  });

  if (authorization.kind !== "allowed") {
    recordCliCounterMetric({
      name: "cli.org.authorization_failure_total",
      tags: {
        action: input.action,
        reason: authorization.reason,
      },
    });
    logCliEvent({
      details: buildCliRequestLogDetails(input.c, {
        action: input.action,
        orgSlug: input.orgSlug,
        reason: authorization.reason,
        roles: authorization.authorization.membershipRoles,
        userId: input.session.user.id,
      }),
      event: "org.action_forbidden",
      level: "warn",
    });
    throwCliProblem({
      detail: `you do not have permission to ${input.action} in org "${input.orgSlug}"`,
      hint: "verify your org role and retry",
      key: "FORBIDDEN",
    });
  }

  return authorization.context;
}

function interpretCliOrgAccessState(
  state: Parameters<
    typeof finishCliOrgAccessWorkflow
  >[0]["access"] extends never
    ? never
    : ReturnType<typeof finishCliOrgAccessWorkflow>
): never {
  if (state.kind === "org_not_found") {
    throwCliProblem({
      key: "ORG_NOT_FOUND",
      detail: `no org named "${state.orgSlug}" exists`,
    });
  }

  if (state.kind === "forbidden") {
    throwCliProblem({
      key: "FORBIDDEN",
      detail: `you do not have access to org "${state.orgSlug}"`,
    });
  }

  throw new Error(`unexpected cli org access state: ${state.kind}`);
}

function parseCliFieldsReadControls(
  input: { fields?: string },
  config: CliReadControlsConfig
): CliFieldsReadControls {
  const selectedFields = parseSelectedFields(
    input.fields,
    config.allowedFields
  );
  if (!selectedFields.ok) {
    throwCliReadControlsProblem({
      detail: selectedFields.message,
      field: "fields",
      hint: config.hint,
      stage: config.fieldStages?.fields ?? config.defaultStage,
    });
  }

  return {
    selectedFields: selectedFields.value,
  };
}

function parseCliPaginatedReadControls(
  input: CliPaginatedQueryInput,
  config: CliReadControlsConfig
): CliPaginatedReadControls {
  const selectedFields = parseSelectedFields(
    input.fields,
    config.allowedFields
  );
  if (!selectedFields.ok) {
    throwCliReadControlsProblem({
      detail: selectedFields.message,
      field: "fields",
      hint: config.hint,
      stage: config.fieldStages?.fields ?? config.defaultStage,
    });
  }

  const offset = parsePageCursor(input.cursor);
  if (!offset.ok) {
    throwCliReadControlsProblem({
      detail: offset.message,
      field: "cursor",
      hint: config.hint,
      stage: config.fieldStages?.cursor ?? config.defaultStage,
    });
  }

  return {
    limit: input.limit ?? CLI_DEFAULT_PAGE_LIMIT,
    offset: offset.value,
    selectedFields: selectedFields.value,
  };
}

function throwCliReadControlsProblem(input: {
  field: string;
  stage: CliApiErrorStage;
  hint: string;
  detail: string;
}): never {
  throwCliProblem({
    detail: input.detail,
    errors: [
      {
        field: input.field,
        message: input.detail,
        code: "invalid",
      },
    ],
    hint: input.hint,
    key: "INVALID_REQUEST",
    stage: input.stage,
  });
}

function buildCliPage(page: {
  nextCursor: string | null;
  returned: number;
  hasMore: boolean;
}) {
  return {
    hasMore: page.hasMore,
    returned: BigInt(page.returned),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

function buildCliAuthSessionUser(user: CliSessionIdentity["user"]) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}

function buildCliAuthSession(session: CliSessionIdentity) {
  const response = {
    authMode: toCliAuthMode(session.authMode),
    user: buildCliAuthSessionUser(toCliAuthUserView(session.user)),
  };

  return {
    ...response,
    ...(session.activeOrg ? { activeOrgSlug: session.activeOrg } : {}),
    ...(session.issuedAt
      ? { issuedAt: timestampFromIsoString(session.issuedAt) }
      : {}),
    ...(session.expiresAt
      ? { expiresAt: timestampFromIsoString(session.expiresAt) }
      : {}),
  };
}

function buildCliRefreshSession(session: CliSessionIdentity) {
  return {
    accessToken: session.accessToken,
    ...buildCliAuthSession(session),
  };
}

function projectCliSessionResponse(
  session: CliSessionIdentity,
  selectedFields: CliSelectedFields
) {
  const response = buildCliAuthSession(session);
  if (!selectedFields) {
    return response;
  }

  const projected: Record<string, unknown> = {};
  if (selectedFields.has("authMode")) {
    projected.authMode = response.authMode;
  }

  const projectedUser = projectCliSessionUser(session.user, selectedFields);
  if (projectedUser) {
    projected.user = projectedUser;
  }

  if (selectedFields.has("activeOrgSlug") && session.activeOrg) {
    projected.activeOrgSlug = session.activeOrg;
  }
  if (selectedFields.has("issuedAt") && session.issuedAt) {
    projected.issuedAt = timestampFromIsoString(session.issuedAt);
  }
  if (selectedFields.has("expiresAt") && session.expiresAt) {
    projected.expiresAt = timestampFromIsoString(session.expiresAt);
  }

  return projected;
}

function projectCliSessionUser(
  user: CliSessionIdentity["user"],
  selectedFields: Exclude<CliSelectedFields, null>
) {
  if (selectedFields.has("user")) {
    return buildCliAuthSessionUser(user);
  }

  const projected: Record<string, unknown> = {};
  if (selectedFields.has("user.id")) {
    projected.id = user.id;
  }
  if (selectedFields.has("user.email")) {
    projected.email = user.email;
  }
  if (selectedFields.has("user.displayName")) {
    projected.displayName = user.displayName;
  }

  return Object.keys(projected).length > 0 ? projected : undefined;
}

function buildAuthorizedDeviceAuthorizationResponse(input: {
  accessToken: string;
  session: CliSessionIdentity | null;
}) {
  const session = input.session;
  if (!session) {
    throwCliProblem({
      detail:
        "device authorization completed, but no authenticated session could be resolved",
      hint: "run `onequery auth login` again",
      key: "NOT_LOGGED_IN",
    });
  }

  return {
    state: "authorized",
    accessToken: input.accessToken,
    authMode: toCliAuthMode(session.authMode),
    user: buildCliAuthSessionUser(session.user),
    ...(session.activeOrg ? { activeOrgSlug: session.activeOrg } : {}),
    ...(session.issuedAt
      ? { issuedAt: timestampFromIsoString(session.issuedAt) }
      : {}),
    ...(session.expiresAt
      ? { expiresAt: timestampFromIsoString(session.expiresAt) }
      : {}),
  };
}

function buildDeviceVerificationUrls(baseUrl: string, userCode: string) {
  const resolvedBaseUrl = new URL(baseUrl);
  const verificationCompleteUrl = new URL("/device", resolvedBaseUrl);
  verificationCompleteUrl.searchParams.set("user_code", userCode);

  return {
    verificationCompleteUrl: verificationCompleteUrl.toString(),
    verificationUrl: new URL("/device", resolvedBaseUrl).toString(),
  };
}

function projectCliOrganizationSummary(
  organization: { slug: string; name: string },
  selectedFields: CliSelectedFields
) {
  if (!selectedFields || selectedFields.has("organizations")) {
    return {
      slug: organization.slug,
      name: organization.name,
    };
  }

  const projected: Record<string, unknown> = {};
  if (selectedFields.has("organizations.slug")) {
    projected.slug = organization.slug;
  }
  if (selectedFields.has("organizations.name")) {
    projected.name = organization.name;
  }

  return projected;
}

function projectCliOrganizationDetails(
  authorizedOrg: AuthorizedCliOrgContext,
  selectedFields: CliSelectedFields
) {
  const response = {
    slug: authorizedOrg.org.slug,
    name: authorizedOrg.org.name,
    roles: authorizedOrg.membershipRoles.map((role) => role),
    capabilities: authorizedOrg.capabilities.map(toCliOrgCapability),
  };

  if (!selectedFields) {
    return response;
  }

  const projected: Record<string, unknown> = {};
  if (selectedFields.has("slug")) {
    projected.slug = response.slug;
  }
  if (selectedFields.has("name")) {
    projected.name = response.name;
  }
  if (selectedFields.has("roles")) {
    projected.roles = response.roles;
  }
  if (selectedFields.has("capabilities")) {
    projected.capabilities = response.capabilities;
  }

  return projected;
}

async function resolveCliUseSkill(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  source: CliUseSkillSource;
  orgSlug?: string;
}) {
  const defaultSkill = getCliUseSkill(input.source);
  const org = await resolveCliUseOrg(input.c, input.orgSlug);

  if (!org) {
    return {
      event: "use.skill.resolved",
      orgSlug: null,
      payload: defaultSkill,
    } as const;
  }

  const db = input.c.var.storage.db;
  const { dataSources } = getDatabaseSchema(db);
  const connectedSource = await db.query.dataSources.findFirst({
    where: and(
      eq(dataSources.organizationId, org.id),
      eq(dataSources.provider, input.source),
      eq(dataSources.status, "active")
    ),
  });

  if (connectedSource) {
    return {
      event: "use.skill.resolved",
      orgSlug: org.slug,
      payload: defaultSkill,
    } as const;
  }

  return {
    event: "use.skill.integration_required",
    orgSlug: org.slug,
    payload: getCliUseIntegrationRequiredSkill({
      orgSlug: org.slug,
      source: input.source,
    }),
  } as const;
}

async function resolveCliUseOrg(
  c: Parameters<typeof buildCliRequestLogDetails>[0],
  requestedOrgSlug?: string
) {
  const session = await resolveCliSessionIdentity(
    c.var.storage,
    c.req.raw.headers
  );
  if (!session) {
    return null;
  }

  const orgSlug = requestedOrgSlug?.trim() || session.activeOrg?.trim();
  if (!orgSlug) {
    return null;
  }

  const decision = finishCliOrgAccessWorkflow({
    access: await runCliLoadOrgAccess({
      db: c.var.storage.db,
      orgSlug,
      userId: session.user.id,
    }),
    orgSlug,
  });
  if (decision.kind !== "allowed") {
    return null;
  }

  const authorization = authorizeCliOrgAccess({
    action: "source.list",
    org: decision.org,
    rawMembershipRole: decision.rawMembershipRole,
  });

  return authorization.kind === "allowed" ? authorization.context.org : null;
}

function buildCliSourceSummaryMessage(
  source: {
    name?: string;
    displayName?: string | null;
    provider?: ProviderType;
    queryable?: boolean;
    status?: DataSourceStatus;
  },
  selectedFields: CliSelectedFields = null,
  scope: "source" | "sources" | null = null
) {
  const projected = projectCliSourceSummary(source, selectedFields, scope);
  const response: Record<string, unknown> = {};

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
) {
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

function buildCliQueryActionTrailActor(input: {
  authorizedOrg: Pick<AuthorizedCliOrgContext, "membershipRoles">;
  session: Pick<CliSessionIdentity, "authMode" | "user">;
}): CliQueryActionTrailActor {
  return {
    authMode: input.session.authMode,
    email: input.session.user.email,
    membershipRoles: [...input.authorizedOrg.membershipRoles],
    userId: input.session.user.id,
  };
}

function logCliQueryActionTrailFailure(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  sourceKey: string;
  actionType: "execute" | "validate";
  operation: "create" | "append";
  eventType?: string;
  error: unknown;
}) {
  recordCliCounterMetric({
    name: "cli.query.action_trail_failure_total",
    tags: {
      actionType: input.actionType,
      eventType: input.eventType ?? null,
      operation: input.operation,
    },
  });
  logCliEvent({
    level: "warn",
    event: "query.action_trail.persistence_failed",
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      queryActionType: input.actionType,
      trailOperation: input.operation,
      eventType: input.eventType ?? null,
      error: toCliErrorMessage(input.error),
    }),
  });
}

function throwCliQueryActionTrailFailure(input: {
  actionType: "execute" | "validate";
  operation: "create" | "append";
  sourceKey: string;
  eventType?: string;
}): never {
  const detail =
    input.operation === "create"
      ? `query action trail could not be created for ${input.actionType} on source "${input.sourceKey}"`
      : `query action trail could not append ${input.eventType ?? "workflow"} for ${input.actionType} on source "${input.sourceKey}"`;

  throwCliProblem({
    detail,
    hint: "retry the CLI query request when the query action trail store is healthy",
    key: "QUERY_PREPARATION_FAILED",
  });
}

function buildQueryValidateResponse(
  response: {
    request: {
      sql: string;
      parameters: readonly unknown[];
      maxRows: number;
      maxBytes: number;
      cellMaxChars: number;
      timeoutMs: number;
    };
    normalizedSql: string;
    declaredResultWindow: {
      maxRows: number;
      maxBytes: number;
      cellMaxChars: number;
      timeoutMs: number;
    };
    source: ReturnType<typeof buildCliSourceSummary>;
    truncated: boolean;
  },
  selectedFields: CliSelectedFields
) {
  if (!selectedFields) {
    return {
      request: {
        sql: response.request.sql,
        parameters: [],
        maxRows: response.request.maxRows,
        maxBytes: response.request.maxBytes,
        cellMaxChars: response.request.cellMaxChars,
        timeoutMs: response.request.timeoutMs,
      },
      normalizedSql: response.normalizedSql,
      declaredResultWindow: {
        maxRows: response.declaredResultWindow.maxRows,
        maxBytes: response.declaredResultWindow.maxBytes,
        cellMaxChars: response.declaredResultWindow.cellMaxChars,
        timeoutMs: response.declaredResultWindow.timeoutMs,
      },
      source: buildCliSourceSummaryMessage(response.source),
      truncated: response.truncated,
    };
  }

  const projected: Record<string, unknown> = {};
  if (selectedFields.has("request")) {
    projected.request = {
      sql: response.request.sql,
      parameters: [],
      maxRows: response.request.maxRows,
      maxBytes: response.request.maxBytes,
      cellMaxChars: response.request.cellMaxChars,
      timeoutMs: response.request.timeoutMs,
    };
  } else if (
    selectedFields.has("request.sql") ||
    selectedFields.has("request.parameters") ||
    selectedFields.has("request.maxRows") ||
    selectedFields.has("request.maxBytes") ||
    selectedFields.has("request.cellMaxChars") ||
    selectedFields.has("request.timeoutMs")
  ) {
    const requestProjection: Record<string, unknown> = {};
    if (selectedFields.has("request.sql")) {
      requestProjection.sql = response.request.sql;
    }
    if (selectedFields.has("request.parameters")) {
      requestProjection.parameters = [];
    }
    if (selectedFields.has("request.maxRows")) {
      requestProjection.maxRows = response.request.maxRows;
    }
    if (selectedFields.has("request.maxBytes")) {
      requestProjection.maxBytes = response.request.maxBytes;
    }
    if (selectedFields.has("request.cellMaxChars")) {
      requestProjection.cellMaxChars = response.request.cellMaxChars;
    }
    if (selectedFields.has("request.timeoutMs")) {
      requestProjection.timeoutMs = response.request.timeoutMs;
    }
    projected.request = requestProjection;
  }

  if (selectedFields.has("normalizedSql")) {
    projected.normalizedSql = response.normalizedSql;
  }

  if (selectedFields.has("declaredResultWindow")) {
    projected.declaredResultWindow = {
      maxRows: response.declaredResultWindow.maxRows,
      maxBytes: response.declaredResultWindow.maxBytes,
      cellMaxChars: response.declaredResultWindow.cellMaxChars,
      timeoutMs: response.declaredResultWindow.timeoutMs,
    };
  } else if (
    selectedFields.has("declaredResultWindow.maxRows") ||
    selectedFields.has("declaredResultWindow.maxBytes") ||
    selectedFields.has("declaredResultWindow.cellMaxChars") ||
    selectedFields.has("declaredResultWindow.timeoutMs")
  ) {
    const windowProjection: Record<string, unknown> = {};
    if (selectedFields.has("declaredResultWindow.maxRows")) {
      windowProjection.maxRows = response.declaredResultWindow.maxRows;
    }
    if (selectedFields.has("declaredResultWindow.maxBytes")) {
      windowProjection.maxBytes = response.declaredResultWindow.maxBytes;
    }
    if (selectedFields.has("declaredResultWindow.cellMaxChars")) {
      windowProjection.cellMaxChars =
        response.declaredResultWindow.cellMaxChars;
    }
    if (selectedFields.has("declaredResultWindow.timeoutMs")) {
      windowProjection.timeoutMs = response.declaredResultWindow.timeoutMs;
    }
    projected.declaredResultWindow = windowProjection;
  }

  const projectedSource = buildCliSourceSummaryMessage(
    response.source,
    selectedFields,
    "source"
  );
  if (Object.keys(projectedSource).length > 0) {
    projected.source = projectedSource;
  }

  if (selectedFields.has("truncated")) {
    projected.truncated = response.truncated;
  }

  return projected;
}

function logCliQueryValidationFailure(
  c: Parameters<typeof buildCliRequestLogDetails>[0],
  sourceKey: string,
  result: CliQueryValidationFailure
) {
  switch (result.kind) {
    case "source_not_found": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_found",
        details: buildCliRequestLogDetails(c, {
          orgSlug: result.orgSlug,
          source: sourceKey,
          httpStatus: 404,
        }),
      });
      return;
    }
    case "source_not_queryable": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_queryable",
        details: buildCliRequestLogDetails(c, {
          source: sourceKey,
          provider: result.provider,
          sourceStatus: result.status,
          httpStatus: 400,
        }),
      });
      return;
    }
    case "query_rejected": {
      logCliEvent({
        level: "warn",
        event: "query.plan.rejected",
        details: buildCliRequestLogDetails(c, {
          source: sourceKey,
          detail: result.detail,
          httpStatus: 400,
        }),
      });
      return;
    }
    case "query_preparation_failed": {
      logCliEvent({
        level: "warn",
        event: "query.plan.preparation_failed",
        details: buildCliRequestLogDetails(c, {
          source: sourceKey,
          detail: result.detail,
          hint: result.hint ?? null,
          httpStatus: 500,
        }),
      });
    }
  }
}

function logCliQueryValidationAccepted(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  sourceKey: string;
  provider: ProviderType;
  truncated: boolean;
}) {
  logCliEvent({
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      provider: input.provider,
      truncated: input.truncated,
    }),
    event: "query.plan.accepted",
    level: "info",
  });
}

function buildQueryExecuteResponse(
  response: {
    source: ReturnType<typeof buildCliSourceSummary>;
    rowCount: number;
    elapsedMs: number;
    columns: readonly { name: string; logicalType: string | null }[];
    rows: readonly (readonly string[])[];
    truncated: boolean;
  },
  selectedFields: CliSelectedFields
) {
  const columns = response.columns.map((column) => ({ ...column }));
  const rows = response.rows.map((row) => [...row]);

  if (!selectedFields) {
    return {
      source: buildCliSourceSummaryMessage(response.source),
      rowCount: BigInt(response.rowCount),
      elapsedMs: BigInt(response.elapsedMs),
      columns: columns.map((column) => ({
        name: column.name,
        ...(column.logicalType
          ? { logicalType: toCliQueryLogicalType(column.logicalType) }
          : {}),
      })),
      rows,
      truncated: response.truncated,
    };
  }

  const projected: Record<string, unknown> = {};
  const projectedSource = buildCliSourceSummaryMessage(
    response.source,
    selectedFields,
    "source"
  );
  if (Object.keys(projectedSource).length > 0) {
    projected.source = projectedSource;
  }
  if (selectedFields.has("rowCount")) {
    projected.rowCount = BigInt(response.rowCount);
  }
  if (selectedFields.has("elapsedMs")) {
    projected.elapsedMs = BigInt(response.elapsedMs);
  }
  if (selectedFields.has("columns")) {
    projected.columns = columns.map((column) => ({
      name: column.name,
      ...(column.logicalType
        ? { logicalType: toCliQueryLogicalType(column.logicalType) }
        : {}),
    }));
  } else if (
    selectedFields.has("columns.name") ||
    selectedFields.has("columns.logicalType")
  ) {
    projected.columns = columns.map((column) => {
      const columnProjection: Record<string, unknown> = {};
      if (selectedFields.has("columns.name")) {
        columnProjection.name = column.name;
      }
      if (selectedFields.has("columns.logicalType") && column.logicalType) {
        columnProjection.logicalType = toCliQueryLogicalType(
          column.logicalType
        );
      }
      return columnProjection;
    });
  }
  if (selectedFields.has("rows")) {
    projected.rows = rows;
  }
  if (selectedFields.has("truncated")) {
    projected.truncated = response.truncated;
  }

  return projected;
}

function logCliQueryExecutionFailure(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  sourceKey: string;
  result: CliQueryExecutionFailure;
  durationMs: number;
}) {
  const httpStatus = getCliQueryFailureHttpStatus(input.result);

  switch (input.result.kind) {
    case "source_not_found": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_found",
        details: buildCliRequestLogDetails(input.c, {
          orgSlug: input.result.orgSlug,
          source: input.sourceKey,
          httpStatus,
          durationMs: input.durationMs,
        }),
      });
      return;
    }
    case "source_not_queryable": {
      logCliEvent({
        level: "warn",
        event: "query.plan.source_not_queryable",
        details: buildCliRequestLogDetails(input.c, {
          source: input.result.sourceName,
          provider: input.result.provider,
          sourceStatus: input.result.status,
          httpStatus,
          durationMs: input.durationMs,
        }),
      });
      return;
    }
    case "query_rejected": {
      logCliEvent({
        level: "warn",
        event: "query.plan.rejected",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          httpStatus,
          durationMs: input.durationMs,
        }),
      });
      return;
    }
    case "query_preparation_failed": {
      logCliEvent({
        level: "warn",
        event: "query.plan.preparation_failed",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          hint: input.result.hint ?? null,
          httpStatus,
          durationMs: input.durationMs,
        }),
      });
      return;
    }
    case "query_unavailable": {
      recordCliCounterMetric({
        name: "cli.query.retryable_total",
        tags: {
          outcome: input.result.kind,
        },
      });
      logCliEvent({
        level: "warn",
        event: "query.execution.unavailable",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          httpStatus,
          durationMs: input.durationMs,
          retryable: true,
        }),
      });
      return;
    }
    case "query_timed_out": {
      recordCliCounterMetric({
        name: "cli.query.timeout_total",
      });
      recordCliCounterMetric({
        name: "cli.query.retryable_total",
        tags: {
          outcome: input.result.kind,
        },
      });
      logCliEvent({
        level: "warn",
        event: "query.execution.timed_out",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          httpStatus,
          durationMs: input.durationMs,
          retryable: true,
        }),
      });
      return;
    }
    case "query_execution_failed": {
      logCliEvent({
        level: "warn",
        event: "query.execution.failed",
        details: buildCliRequestLogDetails(input.c, {
          source: input.sourceKey,
          detail: input.result.detail,
          httpStatus,
          durationMs: input.durationMs,
          retryable: false,
        }),
      });
    }
  }
}

function logCliQueryExecutionSuccess(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  sourceKey: string;
  response: Pick<
    Awaited<ReturnType<typeof runCliQueryExecutionWorkflow>> extends {
      kind: "response_ready";
      response: infer TResponse;
    }
      ? TResponse
      : never,
    "source" | "rowCount" | "elapsedMs" | "truncated"
  >;
  durationMs: number;
  usagePersistence: Awaited<
    ReturnType<typeof runCliQueryExecutionWorkflow>
  > extends {
    kind: "response_ready";
    usagePersistence: infer TUsage;
  }
    ? TUsage
    : never;
}) {
  logCliEvent({
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      provider: input.response.source.provider,
      truncated: input.response.truncated,
      durationMs: input.durationMs,
    }),
    event: "query.plan.accepted",
    level: "info",
  });
  logCliEvent({
    details: buildCliRequestLogDetails(input.c, {
      source: input.sourceKey,
      provider: input.response.source.provider,
      rowCount: input.response.rowCount,
      queryElapsedMs: input.response.elapsedMs,
      durationMs: input.durationMs,
    }),
    event: "query.execution.succeeded",
    level: "info",
  });

  if (input.usagePersistence.kind === "usage_persist_failed") {
    logCliEvent({
      details: buildCliRequestLogDetails(input.c, {
        sourceId: input.usagePersistence.sourceId,
        detail: input.usagePersistence.detail,
      }),
      event: "query.usage_persist_failed",
      level: "warn",
    });
  }
}

function getCliQueryFailureHttpStatus(
  result: CliQueryExecutionFailure
): 400 | 404 | 500 | 503 | 504 {
  switch (result.kind) {
    case "source_not_queryable":
    case "query_rejected": {
      return 400;
    }
    case "source_not_found": {
      return 404;
    }
    case "query_preparation_failed":
    case "query_execution_failed": {
      return 500;
    }
    case "query_unavailable": {
      return 503;
    }
    case "query_timed_out": {
      return 504;
    }
  }
}

function throwIfCliQueryParametersProvided(
  parameters: readonly unknown[] | undefined
) {
  if ((parameters?.length ?? 0) === 0) {
    return;
  }

  throwCliProblem({
    detail: "query parameters are not implemented for the CLI query API yet",
    hint: "inline literal values in SQL and retry",
    key: "INVALID_REQUEST",
    stage: "read_query_input",
  });
}

function sanitizeQueryExecuteResponse(
  data: ReturnType<typeof buildQueryExecuteResponse>
) {
  return {
    ...data,
    columns: Array.isArray(data.columns)
      ? data.columns.map((column) => ({
          ...column,
          name: sanitizeUndefinedableCliRemoteText(
            typeof column === "object" && column !== null && "name" in column
              ? (column.name as string | undefined)
              : undefined
          ),
        }))
      : data.columns,
    rows: Array.isArray(data.rows)
      ? data.rows.map((row) => row.map(sanitizeCliRemoteText))
      : data.rows,
  };
}

function resolveQueryExecuteUntrustedPaths(
  selectedFields: CliSelectedFields,
  hasRows: boolean
) {
  if (!selectedFields) {
    return hasRows
      ? ["$.data.columns[*].name", "$.data.rows[*][*]"]
      : ["$.data.columns[*].name"];
  }

  const untrustedPaths: string[] = [];
  if (selectedFields.has("columns") || selectedFields.has("columns.name")) {
    untrustedPaths.push("$.data.columns[*].name");
  }
  if (hasRows && selectedFields.has("rows")) {
    untrustedPaths.push("$.data.rows[*][*]");
  }

  return untrustedPaths.length > 0 ? untrustedPaths : undefined;
}

function timestampFromIsoString(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }

  return timestampFromDate(parsed);
}

function toCliAuthMode(value: CliSessionIdentity["authMode"]) {
  switch (value) {
    case "browser_session":
      return CliAuthMode.BROWSER_SESSION;
    case "bearer_token":
      return CliAuthMode.BEARER_TOKEN;
  }
}

function toCliUseSourceEnum(value: CliUseSkillSource) {
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

function fromCliUseSource(value: CliUseSource): CliUseSkillSource {
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
      throwCliProblem({
        detail: "unsupported use source",
        hint: "choose one of the supported use sources and retry",
        key: "INVALID_REQUEST",
        stage: "resolve_source",
      });
  }
}

function toCliContentFormat(value: "markdown") {
  switch (value) {
    case "markdown":
      return CliContentFormat.MARKDOWN;
  }
}

function toCliOrgCapability(value: CliAction) {
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

function toCliSourceProvider(value: ProviderType) {
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

function fromCliSourceProvider(value: CliSourceProvider): ProviderType {
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
      throwCliProblem({
        detail: "unsupported source provider",
        hint: "choose a supported source provider and retry",
        key: "INVALID_REQUEST",
        stage: "resolve_source",
      });
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

function toCliQueryLogicalType(value: string) {
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
