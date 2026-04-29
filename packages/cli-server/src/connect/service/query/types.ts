import type { MessageInitShape } from "@bufbuild/protobuf";
import type { Duration } from "@bufbuild/protobuf/wkt";
import {
  QueryLogicalType,
  ExecuteQueryResponseSchema,
  ValidateQueryResponseSchema,
} from "@onequery/proto-cli/cli/v1/query_pb";

import type { AuthorizedCliOrgContext } from "../../../authorization";
import type { CliSessionIdentity } from "../../../domain/workflows";
import { resolveQueryResultWindow } from "../../../query/result-window";
import type { CliSourceInit } from "../source/types";
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

export type ExecuteQueryColumnMessage = {
  name: string;
  logicalType?: QueryLogicalType;
};

export type ExecuteQueryRowMessage = {
  displayValues: string[];
};

export type ValidateQueryResponseInit = {
  declaredResultWindow: NonNullable<
    ValidateQueryResponseMessageInit["declaredResultWindow"]
  >;
  normalizedSql: string;
  request: NonNullable<ValidateQueryResponseMessageInit["request"]>;
  source: CliSourceInit;
  sqlNormalized: boolean;
};

export type ExecuteQueryPayload = {
  columns: ExecuteQueryColumnMessage[];
  elapsed?: Duration;
  rowCount: number;
  rows: ExecuteQueryRowMessage[];
  source: CliSourceInit;
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
