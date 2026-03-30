export const BIGQUERY_API_BASE_URL =
  "https://bigquery.googleapis.com/bigquery/v2";
export const BIGQUERY_SCOPE = "https://www.googleapis.com/auth/bigquery";

export type BigQueryQueryRequest = {
  query: string;
  timeoutMs: number;
  maxResults: number;
  location?: string;
};

export type BigQueryRowField = {
  v?: unknown;
};

export type BigQueryRow = {
  f?: BigQueryRowField[];
};

export type BigQuerySchemaField = {
  name?: string;
  type?: string;
  mode?: string;
  fields?: BigQuerySchemaField[];
};

export type BigQueryTableSchema = {
  fields?: BigQuerySchemaField[];
};

export type BigQueryJobReference = {
  jobId?: string;
  location?: string;
};

export type BigQueryJobsQueryResponse = {
  jobComplete?: boolean;
  jobReference?: BigQueryJobReference;
  queryId?: string;
  rows?: BigQueryRow[];
  schema?: BigQueryTableSchema;
  pageToken?: string;
  location?: string;
  totalBytesProcessed?: string;
  totalBytesBilled?: string;
  cacheHit?: boolean;
};

export type BigQueryJobsInsertResponse = {
  jobReference?: BigQueryJobReference;
  statistics?: {
    query?: {
      totalBytesProcessed?: string;
    };
  };
};

export type BigQueryDatasetsListResponse = {
  datasets?: unknown[];
  nextPageToken?: string;
};

export type BigQueryQueryResult = {
  rows: Record<string, unknown>[];
  jobId?: string;
  location?: string;
  totalBytesProcessed?: string;
  totalBytesBilled?: string;
  cacheHit?: boolean;
};

export type BigQueryQuerySummary = {
  queryId?: string;
  rows: Record<string, unknown>[];
  schema?: BigQueryTableSchema;
  jobId?: string;
  location?: string;
  totalBytesProcessed?: string;
  totalBytesBilled?: string;
  cacheHit?: boolean;
};

export type BigQueryApiRequest = {
  path: string;
  method?: "GET" | "POST";
  timeoutMs?: number;
  query?: Record<string, string>;
  body?: unknown;
};

export type BigQueryRunnerContext = {
  accessTokenPromise: Promise<string>;
  projectId: string;
};

export type BigQueryClient = {
  runDryRun: (input: BigQueryQueryRequest) => Promise<string | null>;
  runQuery: (input: BigQueryQueryRequest) => Promise<BigQueryQueryResult>;
  listDatasets: () => Promise<unknown[]>;
};

export class BigQueryApiError extends Error {
  readonly code: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BigQueryApiError";
    this.code = status;
  }
}
