import { createFactory } from "hono/factory";

import type { CliQueryValidateContext } from "../../../generated/cli.context";
import { zValidator } from "../../../generated/cli.validator";
import {
  CliQueryValidateBody,
  CliQueryValidateParams,
  CliQueryValidateQueryParams,
  CliQueryValidateResponse,
} from "../../../generated/cli.zod";
import type { CliOrgRouteVariables, CliRouteEnv } from "../../app";
import { cliSessionMiddleware } from "../../auth/middleware";
import {
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware,
} from "../../organization/middleware";
import { runCliValidateQueryEffect } from "../../query/effects";
import {
  appendCliQueryActionTrailEvent,
  createCliQueryActionTrail,
} from "../../query/logging";
import { throwForCliQueryPlanResult } from "../../query/model";
import { resolveQueryResultWindow } from "../../query/result-window";
import {
  buildCliQueryActionTrailActor,
  buildQueryValidateResponse,
  logCliQueryActionTrailFailure,
  logCliQueryValidationAccepted,
  logCliQueryValidationFailure,
  throwIfCliQueryParametersProvided,
  throwCliQueryActionTrailFailure,
} from "../../query/transport";
import { runCliQueryValidationWorkflow } from "../../query/workflow";
import { createCliFieldsReadControlsMiddleware } from "../../read-controls";
import type { CliFieldsReadControls } from "../../read-controls";
import { runCliLoadSourceEffect } from "../../source/effects";
import { buildCliSourceSummary } from "../../source/model";
import { createCliValidationHook } from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";

// Comment: Orval's split-mode stub for this handler referenced a nonexistent
// `default/` directory, so this file owns the corrected contract imports.
const factory = createFactory();

type QueryValidateHandlerEnv = CliRouteEnv<
  CliOrgRouteVariables & { readControls: CliFieldsReadControls }
>;

export const cliQueryValidateHandlers = factory.createHandlers(
  cliSessionMiddleware,
  zValidator(
    "param",
    CliQueryValidateParams,
    createCliValidationHook({
      defaultStage: "resolve_source",
      fieldStages: {
        orgSlug: "resolve_org",
        sourceKey: "resolve_source",
      },
      hint: "correct the request and retry",
    })
  ),
  zValidator(
    "query",
    CliQueryValidateQueryParams,
    createCliValidationHook({
      defaultMessage: "invalid query validation request",
      defaultStage: "read_query_input",
      hint: "correct the request query and retry",
    })
  ),
  createCliFieldsReadControlsMiddleware({
    allowedFields: [
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
    ],
    defaultStage: "read_query_input",
    hint: "correct the read controls and retry",
  }),
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware("query.execute"),
  zValidator(
    "json",
    CliQueryValidateBody,
    createCliValidationHook({
      defaultMessage: "invalid query request",
      defaultStage: "read_query_input",
      fieldStages: {
        sql: "read_query_input",
        parameters: "read_query_input",
        maxRows: "read_query_input",
        maxBytes: "read_query_input",
        cellMaxChars: "read_query_input",
        timeoutMs: "read_query_input",
      },
      hint: "correct the request body and retry",
    })
  ),
  zValidator("response", CliQueryValidateResponse),
  async (c: CliQueryValidateContext<QueryValidateHandlerEnv>) => {
    const input = c.req.valid("json");
    const { sourceKey } = c.req.valid("param");

    throwIfCliQueryParametersProvided(input.parameters);

    const resultWindow = resolveQueryResultWindow(input);
    const actionId = (
      await createCliQueryActionTrail({
        actionType: "validate",
        actor: buildCliQueryActionTrailActor({
          authorizedOrg: c.var.authorizedOrg,
          session: c.var.session,
        }),
        cellMaxChars: resultWindow.cellMaxChars,
        db: c.var.db,
        maxBytes: resultWindow.maxBytes,
        maxRows: resultWindow.maxRows,
        organizationId: c.var.authorizedOrg.org.id,
        requestId: c.var.requestId,
        sourceKey,
        sql: input.sql,
        timeoutMs: resultWindow.timeoutMs,
      }).catch((error) => {
        logCliQueryActionTrailFailure({
          actionType: "validate",
          c,
          error,
          operation: "create",
          sourceKey,
        });
        throwCliQueryActionTrailFailure({
          actionType: "validate",
          operation: "create",
          sourceKey,
        });
      })
    ).actionId;
    const result = await runCliQueryValidationWorkflow({
      dispatch: {
        loadSource: async (effect) =>
          runCliLoadSourceEffect({
            db: c.var.db,
            effect,
          }),
        validateQuery: runCliValidateQueryEffect,
      },
      org: c.var.authorizedOrg.org,
      requestId: c.var.requestId,
      sourceName: sourceKey,
      sql: input.sql,
      timeoutMs: resultWindow.timeoutMs,
      observeEvent: async (event) => {
        await appendCliQueryActionTrailEvent({
          actionId,
          db: c.var.db,
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
          sourceKey,
        });
        throwCliQueryActionTrailFailure({
          actionType: "validate",
          eventType: event.type,
          operation: "append",
          sourceKey,
        });
      },
    });

    if (result.kind !== "ready") {
      logCliQueryValidationFailure(c, sourceKey, result);
      throwForCliQueryPlanResult(result);
    }

    logCliQueryValidationAccepted({
      c,
      provider: result.source.provider,
      sourceKey,
      truncated: result.truncated,
    });

    return c.json(
      buildCliSuccessEnvelope({
        data: buildQueryValidateResponse(
          {
            request: {
              sql: result.normalizedSql,
              parameters: input.parameters,
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
          c.var.readControls.selectedFields
        ),
        requestId: c.var.requestId,
      }),
      200
    );
  }
);
