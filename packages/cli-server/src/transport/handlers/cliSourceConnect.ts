import type { ProviderType } from "@onequery/db/server";
import { CreateDataSourceSchema } from "@onequery/server/routes/data-sources/schemas";
import { ensureConnectorOrganization } from "@onequery/server/services/connectors/broker";
import { createFactory } from "hono/factory";

import type { CliSourceConnectContext } from "../../../generated/cli.context";
import { zValidator } from "../../../generated/cli.validator";
import {
  CliSourceConnectBody,
  CliSourceConnectParams,
  CliSourceConnectQueryParams,
  CliSourceConnectResponse,
} from "../../../generated/cli.zod";
import type { CliOrgRouteVariables, CliRouteEnv } from "../../app";
import { cliSessionMiddleware } from "../../auth/middleware";
import { throwCliProblem } from "../../error";
import { isCliSourceKey } from "../../identifiers";
import { buildCliRequestLogDetails, logCliEvent } from "../../observability";
import {
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware,
} from "../../organization/middleware";
import {
  buildCliSourceConnectResult,
  sourceNameConflictProblem,
} from "../../source/connect";
import { runCliConnectSourceEffect } from "../../source/effects";
import {
  createCliValidationHook,
  throwCliValidationProblem,
} from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";

type CliSourceConnectHandlerEnv = CliRouteEnv<CliOrgRouteVariables>;

const factory = createFactory();

function doesProviderMatchCredentials(input: {
  provider: ProviderType;
  credentialsType: string;
}): boolean {
  if (input.provider === input.credentialsType) {
    return true;
  }

  return input.provider === "supabase" && input.credentialsType === "postgres";
}

export const cliSourceConnectHandlers = factory.createHandlers(
  cliSessionMiddleware,
  zValidator(
    "param",
    CliSourceConnectParams,
    createCliValidationHook({
      defaultStage: "resolve_org",
      fieldStages: {
        orgSlug: "resolve_org",
      },
      hint: "correct the request and retry",
    })
  ),
  zValidator(
    "json",
    CliSourceConnectBody,
    createCliValidationHook({
      defaultMessage: "invalid source connect request",
      defaultStage: "resolve_source",
      fieldStages: {
        name: "resolve_source",
        credentials: "resolve_source",
      },
      hint: "correct the request body and retry",
    })
  ),
  zValidator(
    "query",
    CliSourceConnectQueryParams,
    createCliValidationHook({
      defaultMessage: "invalid source connect request",
      defaultStage: "resolve_source",
      fieldStages: {
        source: "resolve_source",
      },
      hint: "correct the request and retry",
    })
  ),
  cliDbMiddleware,
  createCliOrgAuthorizationMiddleware("source.connect"),
  zValidator("response", CliSourceConnectResponse),
  async (c: CliSourceConnectContext<CliSourceConnectHandlerEnv>) => {
    const body = c.req.valid("json");
    const query = c.req.valid("query");

    if (!isCliSourceKey(body.name)) {
      throwCliProblem({
        detail:
          "source name must use only letters, numbers, dots, underscores, or hyphens",
        hint: "rename the source and retry",
        key: "INVALID_REQUEST",
        stage: "resolve_source",
      });
    }

    const parsed = CreateDataSourceSchema.safeParse({
      ...body,
      organizationId: c.var.authorizedOrg.org.id,
      provider: query.source,
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
          data: body,
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
        db: c.var.db,
        organizationId: c.var.authorizedOrg.org.id,
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
      db: c.var.db,
      effect: {
        credentials: parsed.data.credentials,
        kind: "connect_source",
        name: parsed.data.name,
        organizationId: c.var.authorizedOrg.org.id,
        provider: query.source as ProviderType,
      },
      masterEncryptionKey: c.var.runtime.crypto.masterEncryptionKey,
    });

    if (result.kind === "name_conflict") {
      throw sourceNameConflictProblem(
        c.var.authorizedOrg.org.slug,
        result.sourceName
      );
    }

    const response = buildCliSourceConnectResult(result.source);

    logCliEvent({
      details: buildCliRequestLogDetails(c, {
        orgSlug: c.var.authorizedOrg.org.slug,
        provider: response.source.provider,
        roles: c.var.authorizedOrg.membershipRoles,
        sourceName: response.source.name,
      }),
      event: "source.connect.created",
      level: "info",
    });

    return c.json(
      buildCliSuccessEnvelope({
        data: response,
        requestId: c.var.requestId,
      }),
      200
    );
  }
);
