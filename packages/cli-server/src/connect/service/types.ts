import type { ServiceImpl } from "@connectrpc/connect";
import {
  CliAuthService,
  CliOrganizationService,
  CliQueryService,
  CliSourceApiService,
  CliSourceService,
} from "@onequery/proto-cli/cli/v1/cli_pb";
import type { Context } from "hono";

import type { CliRouteEnv } from "../../app";

type CliServiceImplementation = ServiceImpl<typeof CliAuthService> &
  ServiceImpl<typeof CliOrganizationService> &
  ServiceImpl<typeof CliSourceService> &
  ServiceImpl<typeof CliSourceApiService> &
  ServiceImpl<typeof CliQueryService>;

export type CliServiceMethodName = keyof CliServiceImplementation;

export type CliServiceMethod<Name extends CliServiceMethodName> = NonNullable<
  CliServiceImplementation[Name]
>;

export type CliServiceResponse<Name extends CliServiceMethodName> = Awaited<
  ReturnType<CliServiceMethod<Name>>
>;

export type CliHonoContext = Context<CliRouteEnv>;
