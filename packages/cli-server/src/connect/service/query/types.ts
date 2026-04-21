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

type ValidateQueryResponseMessageInit = MessageInitShape<
  typeof ValidateQueryResponseSchema
>;
type ExecuteQueryResponseMessageInit = MessageInitShape<
  typeof ExecuteQueryResponseSchema
>;
type QuerySourceMessageInit = MessageInitShape<typeof CliSourceSchema>;

export type CliQueryServiceRequest = {
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

export type CliSourceInit = MessageInitShape<typeof CliSourceSchema>;

export type QuerySourceInit = {
  displayName?: QuerySourceMessageInit["displayName"];
  provider: QuerySourceMessageInit["provider"];
  queryable: QuerySourceMessageInit["queryable"];
  sourceKey: QuerySourceMessageInit["sourceKey"];
  status: QuerySourceMessageInit["status"];
};

export type ExecuteQueryColumnMessage = {
  name: string;
  logicalType?: QueryLogicalType;
};

export type ExecuteQueryRowMessage = {
  values: string[];
};

export type ValidateQueryResponseInit = {
  declaredResultWindow: NonNullable<
    ValidateQueryResponseMessageInit["declaredResultWindow"]
  >;
  normalizedSql: string;
  request: NonNullable<ValidateQueryResponseMessageInit["request"]>;
  source: QuerySourceInit;
  truncated: boolean;
};

export type ExecuteQueryPayload = {
  columns: ExecuteQueryColumnMessage[];
  elapsedMs: bigint;
  rowCount: bigint;
  rows: ExecuteQueryRowMessage[];
  source: QuerySourceInit;
  truncated: boolean;
};

export type ExecuteQueryResponseInit = ExecuteQueryResponseMessageInit;

export type ResolvedCliQueryRequest<TRequest extends CliQueryServiceRequest> = {
  authorizedOrg: AuthorizedCliOrgContext;
  c: CliHonoContext;
  query: NonNullable<TRequest["query"]>;
  requestId: string;
  resultWindow: ReturnType<typeof resolveQueryResultWindow>;
  session: CliSessionIdentity;
};
