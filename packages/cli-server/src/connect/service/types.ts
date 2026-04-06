import type { ServiceImpl } from "@connectrpc/connect";
import type { Context } from "hono";

import type { CliRouteEnv } from "../../app";
import type { CliAction } from "../../authorization";
import type { CliApiErrorStage } from "../../domain/problems";
import { CliService } from "../gen/onequery/cli/v1/cli_pb";

type CliServiceImplementation = ServiceImpl<typeof CliService>;

export type CliServiceMethod<Name extends keyof CliServiceImplementation> =
  NonNullable<CliServiceImplementation[Name]>;

export type CliHonoContext = Context<CliRouteEnv>;

export type CliReadControlsConfig = {
  allowedFields: readonly string[];
  defaultStage: CliApiErrorStage;
  fieldStages?: Partial<Record<string, CliApiErrorStage>>;
  hint: string;
};

export type CliPaginatedQueryInput = {
  fields?: string;
  limit?: number;
  cursor?: string;
};

export type RequireAuthorizedCliOrgInput = {
  c: CliHonoContext;
  action: CliAction;
  orgSlug: string;
};
