import { Result } from "better-result";

import type { AuthorizedCliOrgContext } from "../../../authorization";
import type { CliSessionIdentity } from "../../../domain/workflows";
import {
  buildCliRequestLogDetails,
  logCliEvent,
  recordCliCounterMetric,
  toCliErrorMessage,
} from "../../../observability";
import {
  appendCliQueryActionTrailEvent,
  createCliQueryActionTrail,
} from "../../../query/logging";
import type { CliQueryActionTrailActor } from "../../../query/logging";
import type { runCliQueryValidationWorkflow } from "../../../query/workflow";
import type { CliConnectProblem } from "../../error";
import type { CliServiceResult } from "../result";
import { createCliServiceProblem } from "../result";
import type { CliHonoContext } from "../types";

type CliQueryActionType = "execute" | "validate";

type CliQueryWorkflowObserver = Pick<
  Parameters<typeof runCliQueryValidationWorkflow>[0],
  "observeEvent" | "observeEventFailure"
>;

export type CliQueryWorkflowObserverController = {
  observer: CliQueryWorkflowObserver;
  getFailure: () => CliConnectProblem | undefined;
};

export function createCliQueryWorkflowObserver(input: {
  actionId: string;
  actionType: CliQueryActionType;
  c: CliHonoContext;
  sourceKey: string;
}): CliQueryWorkflowObserverController {
  let failure: CliConnectProblem | undefined;

  return {
    observer: {
      observeEvent: async (event) => {
        await appendCliQueryActionTrailEvent({
          actionId: input.actionId,
          db: input.c.var.storage.db,
          event,
        });
      },
      observeEventFailure: async ({ error, event }) => {
        logCliQueryActionTrailFailure({
          actionType: input.actionType,
          c: input.c,
          error,
          eventType: event.type,
          operation: "append",
          sourceKey: input.sourceKey,
        });
        failure = createCliQueryActionTrailFailureProblem({
          actionType: input.actionType,
          cause: error,
          eventType: event.type,
          operation: "append",
          sourceKey: input.sourceKey,
        });
      },
    },
    getFailure: () => failure,
  };
}

export async function createCliQueryActionTrailForRequest(input: {
  actionType: CliQueryActionType;
  authorizedOrg: Pick<AuthorizedCliOrgContext, "membershipRoles" | "org">;
  c: CliHonoContext;
  requestId: string;
  resultWindow: {
    cellMaxChars: number;
    maxBytes: number;
    maxRows: number;
    timeoutMs: number;
  };
  session: Pick<CliSessionIdentity, "authMode" | "user">;
  sourceKey: string;
  sql: string;
}): Promise<
  CliServiceResult<Awaited<ReturnType<typeof createCliQueryActionTrail>>>
> {
  return Result.tryPromise({
    try: () =>
      createCliQueryActionTrail({
        actionType: input.actionType,
        actor: buildCliQueryActionTrailActor({
          authorizedOrg: input.authorizedOrg,
          session: input.session,
        }),
        cellMaxChars: input.resultWindow.cellMaxChars,
        db: input.c.var.storage.db,
        maxBytes: input.resultWindow.maxBytes,
        maxRows: input.resultWindow.maxRows,
        organizationId: input.authorizedOrg.org.id,
        requestId: input.requestId,
        sourceKey: input.sourceKey,
        sql: input.sql,
        timeoutMs: input.resultWindow.timeoutMs,
      }),
    catch: (error) => {
      logCliQueryActionTrailFailure({
        actionType: input.actionType,
        c: input.c,
        error,
        operation: "create",
        sourceKey: input.sourceKey,
      });

      return createCliQueryActionTrailFailureProblem({
        actionType: input.actionType,
        cause: error,
        operation: "create",
        sourceKey: input.sourceKey,
      });
    },
  });
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
  actionType: CliQueryActionType;
  c: CliHonoContext;
  error: unknown;
  eventType?: string;
  operation: "create" | "append";
  sourceKey: string;
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

function createCliQueryActionTrailFailureProblem(input: {
  actionType: CliQueryActionType;
  cause?: unknown;
  eventType?: string;
  operation: "create" | "append";
  sourceKey: string;
}) {
  const detail =
    input.operation === "create"
      ? `query action trail could not be created for ${input.actionType} on source "${input.sourceKey}"`
      : `query action trail could not append ${input.eventType ?? "workflow"} for ${input.actionType} on source "${input.sourceKey}"`;

  return createCliServiceProblem({
    ...(input.cause !== undefined ? { cause: input.cause } : {}),
    detail,
    key: "QUERY_PREPARATION_FAILED",
  });
}
