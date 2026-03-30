export type ConnectorErrorCode =
  | "INVALID_QUERY"
  | "AUTH_FAILED"
  | "AWS_ACCESS_DENIED"
  | "QUERY_FAILED"
  | "QUERY_TIMEOUT"
  | "RESULT_TOO_LARGE"
  | "UNKNOWN_ERROR";

export type AthenaQueryJob = {
  jobId: string;
  type: "athena_query";
  sql: string;
  database: string;
  workgroup?: string;
  timeoutMs?: number;
  maxRows?: number;
};

export type AthenaQuerySuccessResult = {
  jobId: string;
  status: "success";
  columns: { name: string; type: string }[];
  rows: string[][];
  stats?: {
    executionTimeMs?: number;
    rowCount?: number;
    dataScannedBytes?: string;
    queryExecutionId?: string;
  };
};

export type AthenaQueryErrorResult = {
  jobId: string;
  status: "error";
  error: {
    code: ConnectorErrorCode;
    message: string;
  };
};

export type ConnectorSession = {
  connectorId: string;
  authToken: string;
};

export type HeartbeatPayload = {
  timestamp: string;
  status: "healthy" | "degraded";
  metadata?: Record<string, string | number | boolean | null>;
};
