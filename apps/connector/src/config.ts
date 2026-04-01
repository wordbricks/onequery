import { existsSync } from "node:fs";
import { join } from "node:path";

import { readTomlFileSync } from "@onequery/config-loader";
import { z } from "zod";

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_QUERY_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
// Comment: keep config/local.toml as the connector's editable local source of
// truth. Process env is only for ad hoc overrides and deployment-managed
// values.
const CONNECTOR_CONFIG_RELATIVE_PATH = "config/local.toml";

const envSchema = z.object({
  ATHENA_DATABASE: z.string().min(1),
  ATHENA_OUTPUT_LOCATION: z
    .string()
    .min(1)
    .regex(
      /^s3:\/\/.+\/$/,
      "ATHENA_OUTPUT_LOCATION must end with a trailing slash"
    ),
  ATHENA_WORKGROUP: z.string().min(1),
  AWS_REGION: z.string().min(1),
  CONNECTOR_NAME: z.string().min(1),
  HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_HEARTBEAT_INTERVAL_MS),
  HTTPS_PROXY: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  MAX_PAYLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_MAX_PAYLOAD_BYTES),
  MAX_ROWS: z.coerce.number().int().positive().default(DEFAULT_MAX_ROWS),
  NODE_EXTRA_CA_CERTS: z.string().optional(),
  ORGANIZATION_ID: z.string().min(1),
  POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_POLL_INTERVAL_MS),
  QUERY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_QUERY_TIMEOUT_MS),
  ONEQUERY_BASE_URL: z.string().url(),
  ONEQUERY_ENROLLMENT_TOKEN: z.string().min(1),
});

type ConnectorConfig = {
  onequeryBaseUrl: string;
  enrollmentToken: string;
  organizationId: string;
  connectorName: string;
  awsRegion: string;
  athenaDatabase: string;
  athenaWorkgroup: string;
  athenaOutputLocation: string;
  pollIntervalMs: number;
  queryTimeoutMs: number;
  maxRows: number;
  maxPayloadBytes: number;
  heartbeatIntervalMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
  httpsProxy?: string;
  nodeExtraCaCerts?: string;
};

function getConnectorConfigPath(rootDir: string = process.cwd()): string {
  return join(rootDir, CONNECTOR_CONFIG_RELATIVE_PATH);
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  rootDir: string = process.cwd()
): ConnectorConfig {
  const parsed = envSchema.parse({
    ...readConnectorTomlConfig(rootDir),
    ...env,
  });

  return toConnectorConfig(parsed);
}

function readConnectorTomlConfig(rootDir: string): Record<string, unknown> {
  const configPath = getConnectorConfigPath(rootDir);

  return existsSync(configPath) ? readTomlFileSync(configPath) : {};
}

function toConnectorConfig(parsed: z.infer<typeof envSchema>): ConnectorConfig {
  return {
    athenaDatabase: parsed.ATHENA_DATABASE,
    athenaOutputLocation: parsed.ATHENA_OUTPUT_LOCATION,
    athenaWorkgroup: parsed.ATHENA_WORKGROUP,
    awsRegion: parsed.AWS_REGION,
    connectorName: parsed.CONNECTOR_NAME,
    enrollmentToken: parsed.ONEQUERY_ENROLLMENT_TOKEN,
    heartbeatIntervalMs: parsed.HEARTBEAT_INTERVAL_MS,
    httpsProxy: parsed.HTTPS_PROXY,
    logLevel: parsed.LOG_LEVEL,
    maxPayloadBytes: parsed.MAX_PAYLOAD_BYTES,
    maxRows: parsed.MAX_ROWS,
    nodeExtraCaCerts: parsed.NODE_EXTRA_CA_CERTS,
    organizationId: parsed.ORGANIZATION_ID,
    pollIntervalMs: parsed.POLL_INTERVAL_MS,
    queryTimeoutMs: parsed.QUERY_TIMEOUT_MS,
    onequeryBaseUrl: trimTrailingSlash(parsed.ONEQUERY_BASE_URL),
  };
}

function trimTrailingSlash(value: string): string {
  if (value.endsWith("/")) {
    return value.slice(0, -1);
  }

  return value;
}
