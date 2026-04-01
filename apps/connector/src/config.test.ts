import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "./config";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function createTempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "onequery-connector-config-"));
  tempDirs.push(dir);
  return dir;
}

describe("loadConfig", () => {
  it("applies schema defaults and trims the base URL", () => {
    const rootDir = createTempRoot();

    const config = loadConfig(
      {
        ATHENA_DATABASE: "analytics",
        ATHENA_OUTPUT_LOCATION: "s3://bucket/prefix/",
        ATHENA_WORKGROUP: "primary",
        AWS_REGION: "ap-northeast-2",
        CONNECTOR_NAME: "athena-main",
        ORGANIZATION_ID: "org_123",
        ONEQUERY_BASE_URL: "https://onequery.example.com/",
        ONEQUERY_ENROLLMENT_TOKEN: "token",
      },
      rootDir
    );

    expect(config).toMatchObject({
      athenaDatabase: "analytics",
      athenaOutputLocation: "s3://bucket/prefix/",
      athenaWorkgroup: "primary",
      awsRegion: "ap-northeast-2",
      connectorName: "athena-main",
      enrollmentToken: "token",
      heartbeatIntervalMs: 15_000,
      logLevel: "info",
      maxPayloadBytes: 5 * 1024 * 1024,
      maxRows: 1000,
      organizationId: "org_123",
      pollIntervalMs: 3000,
      queryTimeoutMs: 60_000,
      onequeryBaseUrl: "https://onequery.example.com",
    });
  });

  it("accepts explicit override values from the environment", () => {
    const rootDir = createTempRoot();

    const config = loadConfig(
      {
        ATHENA_DATABASE: "warehouse",
        ATHENA_OUTPUT_LOCATION: "s3://bucket/results/",
        ATHENA_WORKGROUP: "analytics",
        AWS_REGION: "us-east-1",
        CONNECTOR_NAME: "athena-secondary",
        HEARTBEAT_INTERVAL_MS: "20000",
        HTTPS_PROXY: "http://proxy.internal:8080",
        LOG_LEVEL: "debug",
        MAX_PAYLOAD_BYTES: "4096",
        MAX_ROWS: "250",
        NODE_EXTRA_CA_CERTS: "/tmp/custom-ca.pem",
        ORGANIZATION_ID: "org_456",
        POLL_INTERVAL_MS: "1500",
        QUERY_TIMEOUT_MS: "120000",
        ONEQUERY_BASE_URL: "https://onequery.internal",
        ONEQUERY_ENROLLMENT_TOKEN: "token-2",
      },
      rootDir
    );

    expect(config).toMatchObject({
      heartbeatIntervalMs: 20_000,
      httpsProxy: "http://proxy.internal:8080",
      logLevel: "debug",
      maxPayloadBytes: 4096,
      maxRows: 250,
      nodeExtraCaCerts: "/tmp/custom-ca.pem",
      pollIntervalMs: 1500,
      queryTimeoutMs: 120_000,
      onequeryBaseUrl: "https://onequery.internal",
    });
  });

  it("reads config/local.toml and lets env override it", () => {
    const rootDir = createTempRoot();
    const configDir = join(rootDir, "config");
    const configPath = join(configDir, "local.toml");

    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configPath,
      [
        'ATHENA_DATABASE = "silver"',
        'ATHENA_OUTPUT_LOCATION = "s3://bucket/results/"',
        'ATHENA_WORKGROUP = "analytics"',
        'AWS_REGION = "ap-northeast-2"',
        'CONNECTOR_NAME = "athena-local"',
        'LOG_LEVEL = "info"',
        'ONEQUERY_BASE_URL = "http://localhost:4555/api/"',
        'ONEQUERY_ENROLLMENT_TOKEN = "toml-token"',
        'ORGANIZATION_ID = "org_toml"',
      ].join("\n"),
      "utf8"
    );

    const config = loadConfig(
      {
        AWS_REGION: "us-east-1",
      },
      rootDir
    );

    expect(config).toMatchObject({
      athenaDatabase: "silver",
      athenaOutputLocation: "s3://bucket/results/",
      athenaWorkgroup: "analytics",
      awsRegion: "us-east-1",
      connectorName: "athena-local",
      enrollmentToken: "toml-token",
      logLevel: "info",
      onequeryBaseUrl: "http://localhost:4555/api",
      organizationId: "org_toml",
    });
  });
});
