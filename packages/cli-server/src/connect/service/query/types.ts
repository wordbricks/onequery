import type { MessageInitShape } from "@bufbuild/protobuf";

import type { AuthorizedCliOrgContext } from "../../../authorization";
import type { CliSessionIdentity } from "../../../domain/workflows";
import { resolveQueryResultWindow } from "../../../query/result-window";
import {
  QueryLogicalType,
  ExecuteQueryResponseSchema,
  ValidateQueryResponseSchema,
} from "../../gen/onequery/cli/v1/query_pb";
import { CliSourceSchema } from "../../gen/onequery/cli/v1/source_pb";
import type { CliHonoContext } from "../types";
import type {
  CliQueryExecutionFailureResult,
  CliQueryExecutionWorkflowResult,
  CliQueryWorkflowPreparationFailureResult,
} from "./workflow-result";

type CliQueryRequest = {
  orgSlug: string;
  sourceKey: string;
  query?: {
    cellMaxChars?: number;
    maxBytes?: number;
    maxRows?: number;
    sql: string;
    timeoutMs?: number;
  };
};

export type CliQueryValidationFailure =
  CliQueryWorkflowPreparationFailureResult;

export type CliQueryExecutionSuccess = Extract<
  CliQueryExecutionWorkflowResult,
  { kind: "response_ready" }
>;

export type CliQueryExecutionFailure = CliQueryExecutionFailureResult;

export type ValidateQueryResponseInit = MessageInitShape<
  typeof ValidateQueryResponseSchema
>;
export type ExecuteQueryResponseInit = MessageInitShape<
  typeof ExecuteQueryResponseSchema
>;
export type CliSourceInit = MessageInitShape<typeof CliSourceSchema>;

export type ExecuteQueryColumnMessage = {
  name?: string;
  logicalType?: QueryLogicalType;
};

export type ExecuteQueryRowMessage = {
  values: string[];
};

export type ExecuteQueryPayload = {
  source?: CliSourceInit;
  rowCount?: bigint;
  elapsedMs?: bigint;
  columns?: ExecuteQueryColumnMessage[];
  rows?: ExecuteQueryRowMessage[];
  truncated?: boolean;
};

export type ResolvedCliQueryRequest<TRequest extends CliQueryRequest> = {
  authorizedOrg: AuthorizedCliOrgContext;
  c: CliHonoContext;
  query: NonNullable<TRequest["query"]>;
  requestId: string;
  resultWindow: ReturnType<typeof resolveQueryResultWindow>;
  session: CliSessionIdentity;
};
