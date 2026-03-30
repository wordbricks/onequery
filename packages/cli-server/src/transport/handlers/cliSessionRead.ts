import { createFactory } from "hono/factory";

import type { CliSessionReadContext } from "../../../generated/cli.context";
import { zValidator } from "../../../generated/cli.validator";
import {
  CliSessionReadQueryParams,
  CliSessionReadResponse,
} from "../../../generated/cli.zod";
import type { CliRouteEnv } from "../../app";
import { resolveCliSessionIdentity } from "../../auth/session-identity";
import { createCliFieldsReadControlsMiddleware } from "../../read-controls";
import type { CliFieldsReadControls } from "../../read-controls";
import { createCliValidationHook } from "../../validation";
import { buildCliSuccessEnvelope } from "../envelope";
import {
  buildCliAuthWhoAmIResult,
  projectCliSessionResponse,
  requireCliSessionIdentity,
} from "../session-response";

const factory = createFactory();

export const cliSessionReadHandlers = factory.createHandlers(
  zValidator(
    "query",
    CliSessionReadQueryParams,
    createCliValidationHook({
      defaultMessage: "invalid session request",
      defaultStage: "auth",
      hint: "correct the request query and retry",
    })
  ),
  createCliFieldsReadControlsMiddleware({
    allowedFields: [
      "authMode",
      "user",
      "user.id",
      "user.email",
      "user.displayName",
      "activeOrgSlug",
      "issuedAt",
      "expiresAt",
    ],
    defaultStage: "auth",
    hint: "correct the read controls and retry",
  }),
  zValidator("response", CliSessionReadResponse),
  async (
    c: CliSessionReadContext<
      CliRouteEnv<{ readControls: CliFieldsReadControls }>
    >
  ) => {
    const session = requireCliSessionIdentity(
      await resolveCliSessionIdentity(c.var.storage, c.req.raw.headers)
    );

    return c.json(
      buildCliSuccessEnvelope({
        data: projectCliSessionResponse(
          buildCliAuthWhoAmIResult(session),
          c.var.readControls.selectedFields
        ),
        requestId: c.var.requestId,
      }),
      200
    );
  }
);
