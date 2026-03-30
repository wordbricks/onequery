import { getCliOpenApiDocument as getCliContractOpenApiDocument } from "@onequery/cli-contract";
import { createFactory } from "hono/factory";

import type { CliOpenapiDocumentContext } from "../../../generated/cli.context";
import { zValidator } from "../../../generated/cli.validator";
import { CliOpenapiDocumentResponse } from "../../../generated/cli.zod";
import type { CliRouteEnv } from "../../app";

const factory = createFactory();

export const cliOpenapiDocumentHandlers = factory.createHandlers(
  zValidator("response", CliOpenapiDocumentResponse),
  async (c: CliOpenapiDocumentContext<CliRouteEnv>) =>
    c.json(getCliContractOpenApiDocument(), 200)
);
