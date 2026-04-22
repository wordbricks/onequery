import type { ServiceImpl } from "@connectrpc/connect";
import type { Context } from "hono";

import type { CliRouteEnv } from "../../app";
import type { CliAction } from "../../authorization";
import { CliService } from "../gen/onequery/cli/v1/cli_pb";

type CliServiceImplementation = ServiceImpl<typeof CliService>;

export type CliServiceMethodName = keyof CliServiceImplementation;

export type CliServiceMethod<Name extends CliServiceMethodName> = NonNullable<
  CliServiceImplementation[Name]
>;

export type CliServiceResponse<Name extends CliServiceMethodName> = Awaited<
  ReturnType<CliServiceMethod<Name>>
>;

export type CliHonoContext = Context<CliRouteEnv>;

export type RequireAuthorizedCliOrgInput = {
  c: CliHonoContext;
  action: CliAction;
  orgSlug: string;
};
