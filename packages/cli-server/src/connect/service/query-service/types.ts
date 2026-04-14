import type { MessageInitShape } from "@bufbuild/protobuf";

import type { AuthorizedCliOrgContext } from "../../../authorization";
import type { CliSessionIdentity } from "../../../domain/workflows";
import { resolveQueryResultWindow } from "../../../query/result-window";
import type {
  CliQueryExecutionWorkflowResult,
  CliQueryValidationWorkflowResult,
  runCliQueryExecutionWorkflow,
} from "../../../query/workflow";
import {
  CliQueryLogicalType,
  ExecuteQueryResponseSchema,
  ValidateQueryResponseSchema,
} from "../../gen/onequery/cli/v1/query_pb";
import { GetSourceResponseSchema } from "../../gen/onequery/cli/v1/source_pb";
import type { CliHonoContext } from "../types";

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

export type CliQueryValidationFailure = Exclude<
  CliQueryValidationWorkflowResult,
  { kind: "ready" }
>;

export type CliQueryExecutionSuccess = Extract<
  Awaited<ReturnType<typeof runCliQueryExecutionWorkflow>>,
  { kind: "response_ready" }
>;

export type CliQueryExecutionFailure = Exclude<
  CliQueryExecutionWorkflowResult,
  { kind: "response_ready" }
>;

export type ValidateQueryResponseInit = MessageInitShape<
  typeof ValidateQueryResponseSchema
>;
export type ExecuteQueryResponseInit = MessageInitShape<
  typeof ExecuteQueryResponseSchema
>;
export type GetSourceResponseInit = MessageInitShape<
  typeof GetSourceResponseSchema
>;

export type ExecuteQueryColumnMessage = {
  name?: string;
  logicalType?: CliQueryLogicalType;
};

export type ExecuteQueryRowMessage = {
  values: string[];
};

export type ExecuteQueryPayload = {
  source?: GetSourceResponseInit;
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
