import { describe, expect, it } from "vitest";

import {
  AmplitudeCredentialsSchema,
  AmazonAdsCredentialsSchema,
  AirtableCredentialsSchema,
  BigQueryCredentialsSchema,
  CalCredentialsSchema,
  CloudflareD1CredentialsSchema,
  CloudflareWebAnalyticsCredentialsSchema,
  ConfluenceCredentialsSchema,
  ConnectorCredentialsSchema,
  credentialSchemaMap,
  DiscordCredentialsSchema,
  E2BCredentialsSchema,
  GitHubCredentialsSchema,
  GoogleSearchConsoleCredentialsSchema,
  GoogleAnalyticsCredentialsSchema,
  GranolaCredentialsSchema,
  JiraCredentialsSchema,
  CloudflareWorkersObservabilityCredentialsSchema,
  LinkedInAdsCredentialsSchema,
  isAnalyticsCredentials,
  isDatabaseCredentials,
  isGitHubCredentials,
  isLinearCredentials,
  isMongoCredentials,
  isOAuthCredentials,
  isSlackCredentials,
  isTokenExpired,
  LaminarCredentialsSchema,
  LinearCredentialsSchema,
  MicrosoftClarityCredentialsSchema,
  MixpanelCredentialsSchema,
  MotherDuckCredentialsSchema,
  MongoDBCredentialsSchema,
  MySQLCredentialsSchema,
  OnePasswordCredentialsSchema,
  normalizeEnvVarName,
  PostgresCredentialsSchema,
  PostHogCredentialsSchema,
  SendGridCredentialsSchema,
  SentryCredentialsSchema,
  SlackCredentialsSchema,
  SnowflakeCredentialsSchema,
  TikTokMarketingCredentialsSchema,
  VercelCredentialsSchema,
  safeValidateCredentials,
  validateCredentials,
} from "./credentials";
import type {
  AmplitudeCredentials,
  AmazonAdsCredentials,
  AirtableCredentials,
  BigQueryCredentials,
  CalCredentials,
  CloudflareD1Credentials,
  CloudflareWebAnalyticsCredentials,
  ConfluenceCredentials,
  ConnectorCredentials,
  Credentials,
  DiscordCredentials,
  E2BCredentials,
  GitHubCredentials,
  GoogleSearchConsoleCredentials,
  GoogleAnalyticsCredentials,
  GranolaCredentials,
  JiraCredentials,
  LaminarCredentials,
  LinkedInAdsCredentials,
  LinearCredentials,
  MicrosoftClarityCredentials,
  MixpanelCredentials,
  MotherDuckCredentials,
  MongoDBCredentials,
  MySQLCredentials,
  OnePasswordCredentials,
  PostgresCredentials,
  PostHogCredentials,
  SendGridCredentials,
  SentryCredentials,
  SlackCredentials,
  SnowflakeCredentials,
  TikTokMarketingCredentials,
  VercelCredentials,
} from "./credentials";

describe("credentials schemas", () => {
  describe("PostgresCredentialsSchema", () => {
    it("should validate valid postgres credentials", () => {
      const credentials: PostgresCredentials = {
        database: "mydb",
        host: "localhost",
        password: "secret123",
        port: 5432,
        sslMode: "prefer",
        type: "postgres",
        username: "admin",
      };

      const result = PostgresCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should validate postgres credentials without sslMode (defaults to prefer)", () => {
      const credentials = {
        database: "mydb",
        host: "localhost",
        password: "secret123",
        port: 5432,
        type: "postgres",
        username: "admin",
      };

      const result = PostgresCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sslMode).toBe("prefer");
      }
    });

    it("should reject invalid port (out of range)", () => {
      const credentials = {
        database: "mydb",
        host: "localhost",
        password: "secret123",
        port: 70000,
        type: "postgres",
        username: "admin",
      };

      const result = PostgresCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
      const credentials = {
        host: "localhost",
        type: "postgres",
      };

      const result = PostgresCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject empty host", () => {
      const credentials = {
        database: "mydb",
        host: "",
        password: "secret123",
        port: 5432,
        type: "postgres",
        username: "admin",
      };

      const result = PostgresCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject whitespace-only host", () => {
      const credentials = {
        database: "mydb",
        host: "   ",
        password: "secret123",
        port: 5432,
        type: "postgres",
        username: "admin",
      };

      const result = PostgresCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject whitespace-only password", () => {
      const credentials = {
        database: "mydb",
        host: "localhost",
        password: "   ",
        port: 5432,
        type: "postgres",
        username: "admin",
      };

      const result = PostgresCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should accept connection string format", () => {
      const credentials = {
        database: "production",
        host: "db.example.com",
        password: "p@ssw0rd!#$%",
        port: 5432,
        sslMode: "prefer",
        type: "postgres",
        username: "app_user",
      };

      const result = PostgresCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });
  });

  describe("MySQLCredentialsSchema", () => {
    it("should validate valid mysql credentials", () => {
      const credentials: MySQLCredentials = {
        database: "mydb",
        host: "localhost",
        password: "secret",
        port: 3306,
        sslMode: "prefer",
        type: "mysql",
        username: "root",
      };

      const result = MySQLCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should default port to 3306 if not provided", () => {
      const credentials = {
        database: "mydb",
        host: "localhost",
        password: "secret",
        type: "mysql",
        username: "root",
      };

      const result = MySQLCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(3306);
      }
    });

    it("should reject wrong type", () => {
      const credentials = {
        type: "postgres", // wrong type
        host: "localhost",
        port: 3306,
        database: "mydb",
        username: "root",
        password: "secret",
      };

      const result = MySQLCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });
  });

  describe("SnowflakeCredentialsSchema", () => {
    it("should validate valid snowflake credentials", () => {
      const credentials: SnowflakeCredentials = {
        account: "xy12345.us-east-1",
        database: "ANALYTICS",
        password: "secret",
        role: "ONEQUERY_READONLY",
        schema: "PUBLIC",
        type: "snowflake",
        username: "ONEQUERY_READER",
        warehouse: "ANALYTICS_WH",
      };

      const result = SnowflakeCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should allow optional schema and role", () => {
      const result = SnowflakeCredentialsSchema.safeParse({
        account: "xy12345.us-east-1",
        database: "ANALYTICS",
        password: "secret",
        type: "snowflake",
        username: "ONEQUERY_READER",
        warehouse: "ANALYTICS_WH",
      });

      expect(result.success).toBe(true);
    });

    it("should reject missing required fields", () => {
      const result = SnowflakeCredentialsSchema.safeParse({
        account: "xy12345.us-east-1",
        type: "snowflake",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("MongoDBCredentialsSchema", () => {
    it("should validate valid mongodb credentials", () => {
      const credentials: MongoDBCredentials = {
        connectionString: "mongodb://user:pass@localhost:27017/admin",
        database: "analytics",
        databases: ["analytics", "app"],
        type: "mongodb",
      };

      const result = MongoDBCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should allow optional database fields", () => {
      const credentials = {
        connectionString:
          "mongodb+srv://user:pass@cluster.example.mongodb.net/",
        type: "mongodb",
      };

      const result = MongoDBCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });

    it("should reject missing connection string", () => {
      const credentials = {
        type: "mongodb",
      };

      const result = MongoDBCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject non-mongodb connection strings", () => {
      const credentials = {
        connectionString: "postgres://user:pass@localhost:5432/app",
        type: "mongodb",
      };

      const result = MongoDBCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });
  });

  describe("GoogleAnalyticsCredentialsSchema", () => {
    it("should validate valid GA credentials", () => {
      const credentials: GoogleAnalyticsCredentials = {
        accessToken: "ya29.xxx",
        expiresAt: Date.now() + 3600000,
        propertyId: "properties/123456789",
        refreshToken: "1//xxx",
        type: "ga",
      };

      const result = GoogleAnalyticsCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should validate GA service account credentials", () => {
      const credentials: GoogleAnalyticsCredentials = {
        authType: "service_account",
        propertyId: "properties/123456789",
        serviceAccount: {
          projectId: "ga-project",
          clientEmail: "ga-service@example.com",
          privateKey:
            "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        },
        type: "ga",
      };

      const result = GoogleAnalyticsCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should reject missing accessToken", () => {
      const credentials = {
        expiresAt: Date.now() + 3600000,
        propertyId: "properties/123456789",
        refreshToken: "1//xxx",
        type: "ga",
      };

      const result = GoogleAnalyticsCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject invalid expiresAt (negative)", () => {
      const credentials = {
        accessToken: "ya29.xxx",
        expiresAt: -1,
        propertyId: "properties/123456789",
        refreshToken: "1//xxx",
        type: "ga",
      };

      const result = GoogleAnalyticsCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject whitespace-only oauth tokens", () => {
      const credentials = {
        accessToken: "   ",
        expiresAt: Date.now() + 3600000,
        propertyId: "properties/123456789",
        refreshToken: "   ",
        type: "ga",
      };

      const result = GoogleAnalyticsCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject whitespace-only service account private keys", () => {
      const credentials = {
        authType: "service_account",
        propertyId: "properties/123456789",
        serviceAccount: {
          clientEmail: "ga-service@example.com",
          privateKey: "   ",
          projectId: "ga-project",
        },
        type: "ga",
      };

      const result = GoogleAnalyticsCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });
  });

  describe("BigQueryCredentialsSchema", () => {
    it("should validate valid BigQuery credentials", () => {
      const credentials: BigQueryCredentials = {
        accessToken: "ya29.xxx",
        expiresAt: Date.now() + 3600000,
        projectId: "my-project-123",
        refreshToken: "1//xxx",
        type: "bigquery",
      };

      const result = BigQueryCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should validate BigQuery service account credentials", () => {
      const credentials: BigQueryCredentials = {
        authType: "service_account",
        projectId: "my-project-123",
        serviceAccount: {
          projectId: "my-project-123",
          clientEmail: "bq-service@example.com",
          privateKey:
            "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        },
        type: "bigquery",
      };

      const result = BigQueryCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should reject empty projectId", () => {
      const credentials = {
        accessToken: "ya29.xxx",
        expiresAt: Date.now() + 3600000,
        projectId: "",
        refreshToken: "1//xxx",
        type: "bigquery",
      };

      const result = BigQueryCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject missing refreshToken", () => {
      const credentials = {
        accessToken: "ya29.xxx",
        expiresAt: Date.now() + 3600000,
        projectId: "my-project",
        type: "bigquery",
      };

      const result = BigQueryCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });
  });

  describe("CloudflareD1CredentialsSchema", () => {
    it("should validate valid Cloudflare D1 credentials", () => {
      const credentials: CloudflareD1Credentials = {
        accountId: "023e105f4ecef8ad9ca31a8372d0c353",
        apiToken: "cf_api_token",
        databaseId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        type: "cloudflare_d1",
      };

      const result = CloudflareD1CredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should accept optional apiBaseUrl", () => {
      const credentials: CloudflareD1Credentials = {
        accountId: "023e105f4ecef8ad9ca31a8372d0c353",
        apiBaseUrl: "https://api.cloudflare.com/client/v4",
        apiToken: "cf_api_token",
        databaseId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        type: "cloudflare_d1",
      };

      const result = CloudflareD1CredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apiBaseUrl).toBe(
          "https://api.cloudflare.com/client/v4"
        );
      }
    });

    it("should treat blank optional apiBaseUrl as undefined", () => {
      const result = CloudflareD1CredentialsSchema.safeParse({
        accountId: "023e105f4ecef8ad9ca31a8372d0c353",
        apiBaseUrl: "   ",
        apiToken: "cf_api_token",
        databaseId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        type: "cloudflare_d1",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apiBaseUrl).toBeUndefined();
      }
    });

    it("should reject missing databaseId", () => {
      const result = CloudflareD1CredentialsSchema.safeParse({
        accountId: "023e105f4ecef8ad9ca31a8372d0c353",
        apiToken: "cf_api_token",
        type: "cloudflare_d1",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("LaminarCredentialsSchema", () => {
    it("should validate valid Laminar credentials", () => {
      const credentials: LaminarCredentials = {
        apiKey: "lmnr_project_key_123",
        type: "laminar",
      };

      const result = LaminarCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should accept optional apiBaseUrl", () => {
      const credentials: LaminarCredentials = {
        apiBaseUrl: "https://api.lmnr.ai",
        apiKey: "lmnr_project_key_123",
        type: "laminar",
      };

      const result = LaminarCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apiBaseUrl).toBe("https://api.lmnr.ai");
      }
    });

    it("should treat blank optional apiBaseUrl as undefined", () => {
      const result = LaminarCredentialsSchema.safeParse({
        apiBaseUrl: "   ",
        apiKey: "lmnr_project_key_123",
        type: "laminar",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apiBaseUrl).toBeUndefined();
      }
    });

    it("should reject invalid apiBaseUrl", () => {
      const credentials = {
        apiBaseUrl: "not-a-url",
        apiKey: "lmnr_project_key_123",
        type: "laminar",
      };

      const result = LaminarCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject empty apiKey", () => {
      const credentials = {
        apiKey: "",
        type: "laminar",
      };

      const result = LaminarCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject missing apiKey", () => {
      const credentials = {
        type: "laminar",
      };

      const result = LaminarCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });
  });

  describe("MotherDuckCredentialsSchema", () => {
    it("should validate valid MotherDuck credentials", () => {
      const credentials: MotherDuckCredentials = {
        database: "md:analytics",
        host: "pg.us-east-1-aws.motherduck.com",
        port: 5432,
        token: "md_token",
        type: "motherduck",
        username: "postgres",
      };

      const result = MotherDuckCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should apply MotherDuck endpoint defaults", () => {
      const result = MotherDuckCredentialsSchema.safeParse({
        token: "md_token",
        type: "motherduck",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          database: "md:",
          host: "pg.us-east-1-aws.motherduck.com",
          port: 5432,
          token: "md_token",
          type: "motherduck",
          username: "postgres",
        });
      }
    });

    it("should normalize plain database names to md: database paths", () => {
      const result = MotherDuckCredentialsSchema.safeParse({
        database: "analytics",
        token: "md_token",
        type: "motherduck",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.database).toBe("md:analytics");
      }
    });

    it("should reject missing token", () => {
      const result = MotherDuckCredentialsSchema.safeParse({
        type: "motherduck",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("ConnectorCredentialsSchema", () => {
    it("should validate valid connector credentials", () => {
      const credentials: ConnectorCredentials = {
        connectorId: "connector_123",
        database: "analytics",
        maxRows: 1_000,
        timeoutMs: 60_000,
        type: "aws_athena_connector",
        workgroup: "primary",
      };

      const result = ConnectorCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should accept optional workgroup timeout and maxRows", () => {
      const result = ConnectorCredentialsSchema.safeParse({
        connectorId: "connector_123",
        database: "analytics",
        type: "aws_athena_connector",
      });

      expect(result.success).toBe(true);
    });

    it("should reject missing connectorId", () => {
      const result = ConnectorCredentialsSchema.safeParse({
        database: "analytics",
        type: "aws_athena_connector",
      });

      expect(result.success).toBe(false);
    });

    it("should reject missing database", () => {
      const result = ConnectorCredentialsSchema.safeParse({
        connectorId: "connector_123",
        type: "aws_athena_connector",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("validateCredentials", () => {
    it("should validate and return credentials", () => {
      const credentials = {
        database: "mydb",
        host: "localhost",
        password: "secret",
        port: 5432,
        type: "postgres",
        username: "admin",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("postgres");
    });

    it("should throw on invalid credentials", () => {
      const credentials = {
        host: "",
        type: "postgres", // invalid
      };

      expect(() => validateCredentials(credentials)).toThrow();
    });
  });

  describe("safeValidateCredentials", () => {
    it("should return success result for valid credentials", () => {
      const credentials = {
        database: "mydb",
        host: "localhost",
        password: "secret",
        type: "mysql",
        username: "root",
      };

      const result = safeValidateCredentials(credentials);
      expect(result.success).toBe(true);
    });

    it("should return error result for invalid credentials", () => {
      const credentials = {
        type: "unknown",
      };

      const result = safeValidateCredentials(credentials);
      expect(result.success).toBe(false);
    });
  });

  describe("isTokenExpired", () => {
    it("should return false for future expiration", () => {
      const expiresAt = Date.now() + 3_600_000; // 1 hour from now
      expect(isTokenExpired(expiresAt)).toBe(false);
    });

    it("should return true for past expiration", () => {
      const expiresAt = Date.now() - 1000; // 1 second ago
      expect(isTokenExpired(expiresAt)).toBe(true);
    });

    it("should return true when within buffer time", () => {
      const expiresAt = Date.now() + 60_000; // 1 minute from now
      const bufferMs = 5 * 60 * 1000; // 5 minutes buffer
      expect(isTokenExpired(expiresAt, bufferMs)).toBe(true);
    });

    it("should return false when outside buffer time", () => {
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes from now
      const bufferMs = 5 * 60 * 1000; // 5 minutes buffer
      expect(isTokenExpired(expiresAt, bufferMs)).toBe(false);
    });
  });

  describe("isOAuthCredentials", () => {
    it("should return false for GA service account credentials", () => {
      const credentials: GoogleAnalyticsCredentials = {
        authType: "service_account",
        propertyId: "prop",
        serviceAccount: {
          projectId: "ga-project",
          clientEmail: "ga-service@example.com",
          privateKey:
            "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        },
        type: "ga",
      };
      expect(isOAuthCredentials(credentials)).toBe(false);
    });

    it("should return false for BigQuery service account credentials", () => {
      const credentials: BigQueryCredentials = {
        authType: "service_account",
        projectId: "proj",
        serviceAccount: {
          projectId: "proj",
          clientEmail: "bq-service@example.com",
          privateKey:
            "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        },
        type: "bigquery",
      };
      expect(isOAuthCredentials(credentials)).toBe(false);
    });
  });

  describe("isMongoCredentials", () => {
    it("should return true for MongoDB credentials", () => {
      const credentials: MongoDBCredentials = {
        connectionString: "mongodb://user:pass@localhost:27017/admin",
        type: "mongodb",
      };
      expect(isMongoCredentials(credentials)).toBe(true);
    });

    it("should return false for MySQL credentials", () => {
      const credentials: MySQLCredentials = {
        database: "db",
        host: "localhost",
        password: "pass",
        port: 3306,
        sslMode: "prefer",
        type: "mysql",
        username: "user",
      };
      expect(isMongoCredentials(credentials)).toBe(false);
    });
  });

  describe("AmplitudeCredentialsSchema", () => {
    it("should validate valid Amplitude credentials", () => {
      const credentials: AmplitudeCredentials = {
        apiKey: "amp-api-key-123",
        region: "us",
        secretKey: "amp-secret-key-456",
        type: "amplitude",
      };

      const result = AmplitudeCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should default region to 'us' if not provided", () => {
      const credentials = {
        apiKey: "amp-api-key",
        secretKey: "amp-secret-key",
        type: "amplitude",
      };

      const result = AmplitudeCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.region).toBe("us");
      }
    });

    it("should accept 'eu' region", () => {
      const credentials = {
        apiKey: "amp-api-key",
        region: "eu",
        secretKey: "amp-secret-key",
        type: "amplitude",
      };

      const result = AmplitudeCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.region).toBe("eu");
      }
    });

    it("should reject invalid region", () => {
      const credentials = {
        apiKey: "amp-api-key",
        region: "asia",
        secretKey: "amp-secret-key",
        type: "amplitude",
      };

      const result = AmplitudeCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject empty apiKey", () => {
      const credentials = {
        apiKey: "",
        secretKey: "amp-secret-key",
        type: "amplitude",
      };

      const result = AmplitudeCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject empty secretKey", () => {
      const credentials = {
        apiKey: "amp-api-key",
        secretKey: "",
        type: "amplitude",
      };

      const result = AmplitudeCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
      const credentials = {
        apiKey: "amp-api-key",
        type: "amplitude",
      };

      const result = AmplitudeCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });
  });

  describe("MixpanelCredentialsSchema", () => {
    it("should validate valid Mixpanel credentials", () => {
      const credentials: MixpanelCredentials = {
        projectId: "project-12345",
        region: "us",
        secret: "service-account-secret",
        type: "mixpanel",
        username: "service-account-user",
      };

      const result = MixpanelCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should reject empty username", () => {
      const credentials = {
        projectId: "project-123",
        secret: "secret",
        type: "mixpanel",
        username: "",
      };

      const result = MixpanelCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject empty secret", () => {
      const credentials = {
        projectId: "project-123",
        secret: "",
        type: "mixpanel",
        username: "user",
      };

      const result = MixpanelCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject empty projectId", () => {
      const credentials = {
        projectId: "",
        secret: "secret",
        type: "mixpanel",
        username: "user",
      };

      const result = MixpanelCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
      const credentials = {
        type: "mixpanel",
        username: "user",
      };

      const result = MixpanelCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should default region to 'us' if not provided", () => {
      const credentials = {
        projectId: "project-123",
        secret: "secret",
        type: "mixpanel",
        username: "user",
      };

      const result = MixpanelCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.region).toBe("us");
      }
    });

    it("should accept supported regions", () => {
      const eu = MixpanelCredentialsSchema.safeParse({
        projectId: "project-123",
        region: "eu",
        secret: "secret",
        type: "mixpanel",
        username: "user",
      });
      const india = MixpanelCredentialsSchema.safeParse({
        projectId: "project-123",
        region: "in",
        secret: "secret",
        type: "mixpanel",
        username: "user",
      });

      expect(eu.success).toBe(true);
      expect(india.success).toBe(true);
    });

    it("should reject invalid region", () => {
      const credentials = {
        projectId: "project-123",
        region: "asia",
        secret: "secret",
        type: "mixpanel",
        username: "user",
      };

      const result = MixpanelCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should accept optional workspaceId", () => {
      const credentials = {
        projectId: "project-123",
        secret: "secret",
        type: "mixpanel",
        username: "user",
        workspaceId: "workspace-1",
      };

      const result = MixpanelCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workspaceId).toBe("workspace-1");
      }
    });

    it("should treat blank optional workspaceId as undefined", () => {
      const result = MixpanelCredentialsSchema.safeParse({
        projectId: "project-123",
        secret: "secret",
        type: "mixpanel",
        username: "user",
        workspaceId: "   ",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workspaceId).toBeUndefined();
      }
    });
  });

  describe("PostHogCredentialsSchema", () => {
    it("should validate valid PostHog credentials", () => {
      const credentials: PostHogCredentials = {
        hostUrl: "https://us.posthog.com",
        personalApiKey: "phx_valid_personal_api_key",
        projectId: "12345",
        type: "posthog",
      };

      const result = PostHogCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should reject empty projectId", () => {
      const result = PostHogCredentialsSchema.safeParse({
        hostUrl: "https://us.posthog.com",
        personalApiKey: "phx_valid_personal_api_key",
        projectId: "",
        type: "posthog",
      });

      expect(result.success).toBe(false);
    });

    it("should reject empty personalApiKey", () => {
      const result = PostHogCredentialsSchema.safeParse({
        hostUrl: "https://us.posthog.com",
        personalApiKey: "",
        projectId: "12345",
        type: "posthog",
      });

      expect(result.success).toBe(false);
    });

    it("should reject invalid hostUrl", () => {
      const result = PostHogCredentialsSchema.safeParse({
        hostUrl: "not-a-url",
        personalApiKey: "phx_valid_personal_api_key",
        projectId: "12345",
        type: "posthog",
      });

      expect(result.success).toBe(false);
    });

    it("should trim hostUrl before validation", () => {
      const result = PostHogCredentialsSchema.safeParse({
        hostUrl: "  https://us.posthog.com/  ",
        personalApiKey: "phx_valid_personal_api_key",
        projectId: "12345",
        type: "posthog",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hostUrl).toBe("https://us.posthog.com");
      }
    });
  });

  describe("SentryCredentialsSchema", () => {
    it("should validate valid Sentry credentials", () => {
      const credentials: SentryCredentials = {
        apiBaseUrl: "https://sentry.io/api/0",
        authToken: "sntrys_123",
        organizationSlug: "acme",
        projectSlug: "frontend",
        type: "sentry",
      };

      const result = SentryCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should accept optional projectSlug and apiBaseUrl", () => {
      const result = SentryCredentialsSchema.safeParse({
        authToken: "sntrys_123",
        organizationSlug: "acme",
        type: "sentry",
      });

      expect(result.success).toBe(true);
    });

    it("should treat blank optional projectSlug and apiBaseUrl as undefined", () => {
      const result = SentryCredentialsSchema.safeParse({
        apiBaseUrl: "   ",
        authToken: "sntrys_123",
        organizationSlug: "acme",
        projectSlug: "   ",
        type: "sentry",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apiBaseUrl).toBeUndefined();
        expect(result.data.projectSlug).toBeUndefined();
      }
    });

    it("should reject empty authToken", () => {
      const result = SentryCredentialsSchema.safeParse({
        authToken: "",
        organizationSlug: "acme",
        type: "sentry",
      });

      expect(result.success).toBe(false);
    });

    it("should reject whitespace-only authToken", () => {
      const result = SentryCredentialsSchema.safeParse({
        authToken: "   ",
        organizationSlug: "acme",
        type: "sentry",
      });

      expect(result.success).toBe(false);
    });

    it("should reject empty organizationSlug", () => {
      const result = SentryCredentialsSchema.safeParse({
        authToken: "sntrys_123",
        organizationSlug: "",
        type: "sentry",
      });

      expect(result.success).toBe(false);
    });

    it("should reject invalid apiBaseUrl", () => {
      const result = SentryCredentialsSchema.safeParse({
        apiBaseUrl: "not-a-url",
        authToken: "sntrys_123",
        organizationSlug: "acme",
        type: "sentry",
      });

      expect(result.success).toBe(false);
    });

    it("should trim organizationSlug before validation", () => {
      const result = SentryCredentialsSchema.safeParse({
        authToken: "sntrys_123",
        organizationSlug: "  acme  ",
        type: "sentry",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.organizationSlug).toBe("acme");
      }
    });
  });

  describe("GitHubCredentialsSchema", () => {
    it("should validate valid GitHub credentials", () => {
      const credentials: GitHubCredentials = {
        accessToken: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        type: "github",
      };

      const result = GitHubCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should accept optional installationId", () => {
      const credentials = {
        accessToken: "ghp_xxx",
        installationId: "12345678",
        type: "github",
      };

      const result = GitHubCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.installationId).toBe("12345678");
      }
    });

    it("should accept optional repositories list", () => {
      const credentials = {
        accessToken: "ghp_xxx",
        repositories: ["onequery/onequery2", "onequery/website"],
        type: "github",
      };

      const result = GitHubCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.repositories).toEqual([
          "onequery/onequery2",
          "onequery/website",
        ]);
      }
    });

    it("should work without installationId", () => {
      const credentials = {
        accessToken: "ghp_xxx",
        type: "github",
      };

      const result = GitHubCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.installationId).toBeUndefined();
      }
    });

    it("should treat blank optional installationId as undefined", () => {
      const result = GitHubCredentialsSchema.safeParse({
        accessToken: "ghp_xxx",
        installationId: "   ",
        type: "github",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.installationId).toBeUndefined();
      }
    });

    it("should reject empty accessToken", () => {
      const credentials = {
        accessToken: "",
        type: "github",
      };

      const result = GitHubCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject whitespace-only accessToken", () => {
      const credentials = {
        accessToken: "   ",
        type: "github",
      };

      const result = GitHubCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject missing accessToken", () => {
      const credentials = {
        type: "github",
      };

      const result = GitHubCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });
  });

  describe("AirtableCredentialsSchema", () => {
    it("validates Airtable credentials and trims optional fields", () => {
      const result = AirtableCredentialsSchema.safeParse({
        apiBaseUrl: "  https://api.airtable.com/v0  ",
        baseId: "  app123  ",
        personalAccessToken: "pat123",
        type: "airtable",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const credentials: AirtableCredentials = result.data;
        expect(credentials.apiBaseUrl).toBe("https://api.airtable.com/v0");
        expect(credentials.baseId).toBe("app123");
      }
    });

    it("rejects missing personal access token", () => {
      const result = AirtableCredentialsSchema.safeParse({
        baseId: "app123",
        type: "airtable",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("DiscordCredentialsSchema", () => {
    it("defaults authScheme to bot", () => {
      const result = DiscordCredentialsSchema.safeParse({
        guildId: "123456789012345678",
        token: "discord-token",
        type: "discord",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const credentials: DiscordCredentials = result.data;
        expect(credentials.authScheme).toBe("bot");
      }
    });

    it("accepts bearer auth scheme", () => {
      const result = DiscordCredentialsSchema.safeParse({
        authScheme: "bearer",
        token: "oauth-token",
        type: "discord",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("SlackCredentialsSchema", () => {
    it("validates canonical Slack credentials", () => {
      const credentials: SlackCredentials = {
        botScopes: ["channels:read", "channels:history"],
        botToken: "xoxb-token",
        botUserId: "U123",
        teamId: "T123",
        teamName: "Acme",
        type: "slack",
      };

      const result = SlackCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });

    it("normalizes legacy comma-delimited scope credentials", () => {
      const result = SlackCredentialsSchema.safeParse({
        botToken: "xoxb-token",
        botUserId: "U123",
        scope: "channels:read, channels:history,",
        teamId: "T123",
        teamName: "Acme",
        type: "slack",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          botScopes: ["channels:read", "channels:history"],
          botToken: "xoxb-token",
          botUserId: "U123",
          teamId: "T123",
          teamName: "Acme",
          type: "slack",
        });
      }
    });

    it("rejects blank bot tokens", () => {
      const result = SlackCredentialsSchema.safeParse({
        botScopes: ["channels:read"],
        botToken: "   ",
        botUserId: "U123",
        teamId: "T123",
        teamName: "Acme",
        type: "slack",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("CalCredentialsSchema", () => {
    it("defaults apiVersion to the current v2 header version", () => {
      const result = CalCredentialsSchema.safeParse({
        apiKey: "cal_123",
        type: "cal",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const credentials: CalCredentials = result.data;
        expect(credentials.apiVersion).toBe("2026-05-01");
      }
    });

    it("rejects missing API key", () => {
      const result = CalCredentialsSchema.safeParse({
        type: "cal",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("GranolaCredentialsSchema", () => {
    it("validates Granola credentials", () => {
      const credentials: GranolaCredentials = {
        apiKey: "grn_123",
        type: "granola",
      };

      const result = GranolaCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });

    it("rejects invalid apiBaseUrl", () => {
      const result = GranolaCredentialsSchema.safeParse({
        apiBaseUrl: "not-a-url",
        apiKey: "grn_123",
        type: "granola",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("GoogleSearchConsoleCredentialsSchema", () => {
    it("validates Google Search Console credentials", () => {
      const credentials: GoogleSearchConsoleCredentials = {
        accessToken: "ya29.token",
        siteUrl: "https://www.example.com/",
        type: "google_search_console",
      };

      const result =
        GoogleSearchConsoleCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });

    it("rejects missing access token", () => {
      const result = GoogleSearchConsoleCredentialsSchema.safeParse({
        siteUrl: "https://www.example.com/",
        type: "google_search_console",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("ConfluenceCredentialsSchema", () => {
    it("validates Confluence credentials and trims siteUrl", () => {
      const result = ConfluenceCredentialsSchema.safeParse({
        apiToken: "atlassian-token",
        email: "reader@example.com",
        siteUrl: "https://example.atlassian.net/",
        type: "confluence",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const credentials: ConfluenceCredentials = result.data;
        expect(credentials.siteUrl).toBe("https://example.atlassian.net");
      }
    });

    it("rejects invalid email", () => {
      const result = ConfluenceCredentialsSchema.safeParse({
        apiToken: "atlassian-token",
        email: "not-an-email",
        siteUrl: "https://example.atlassian.net",
        type: "confluence",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("AmazonAdsCredentialsSchema", () => {
    it("defaults region to North America", () => {
      const result = AmazonAdsCredentialsSchema.safeParse({
        accessToken: "Atza|token",
        clientId: "amzn1.application-oa2-client.test",
        type: "amazon_ads",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const credentials: AmazonAdsCredentials = result.data;
        expect(credentials.region).toBe("na");
      }
    });

    it("accepts supported Amazon Ads regions", () => {
      const eu = AmazonAdsCredentialsSchema.safeParse({
        accessToken: "Atza|token",
        clientId: "client-id",
        region: "eu",
        type: "amazon_ads",
      });
      const fe = AmazonAdsCredentialsSchema.safeParse({
        accessToken: "Atza|token",
        clientId: "client-id",
        region: "fe",
        type: "amazon_ads",
      });

      expect(eu.success).toBe(true);
      expect(fe.success).toBe(true);
    });
  });

  describe("LinkedInAdsCredentialsSchema", () => {
    it("defaults to the current LinkedIn Marketing API version", () => {
      const result = LinkedInAdsCredentialsSchema.safeParse({
        accessToken: "linkedin-token",
        type: "linkedin_ads",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const credentials: LinkedInAdsCredentials = result.data;
        expect(credentials.apiVersion).toBe("202605");
      }
    });

    it("accepts optional API base URL and version override", () => {
      const result = LinkedInAdsCredentialsSchema.safeParse({
        accessToken: "linkedin-token",
        apiBaseUrl: "https://api.linkedin.com/rest",
        apiVersion: "202604",
        type: "linkedin_ads",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("TikTokMarketingCredentialsSchema", () => {
    it("validates TikTok Marketing credentials", () => {
      const result = TikTokMarketingCredentialsSchema.safeParse({
        accessToken: "tiktok-token",
        advertiserId: "1234567890",
        type: "tiktok_marketing",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const credentials: TikTokMarketingCredentials = result.data;
        expect(credentials.advertiserId).toBe("1234567890");
      }
    });

    it("treats blank optional advertiserId as undefined", () => {
      const result = TikTokMarketingCredentialsSchema.safeParse({
        accessToken: "tiktok-token",
        advertiserId: "   ",
        type: "tiktok_marketing",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.advertiserId).toBeUndefined();
      }
    });
  });

  describe("SendGridCredentialsSchema", () => {
    it("validates SendGrid credentials", () => {
      const credentials: SendGridCredentials = {
        apiKey: "SG.xxxxx",
        type: "sendgrid",
      };

      const result = SendGridCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });

    it("rejects missing API key", () => {
      const result = SendGridCredentialsSchema.safeParse({
        type: "sendgrid",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("JiraCredentialsSchema", () => {
    it("validates Jira credentials and trims siteUrl", () => {
      const result = JiraCredentialsSchema.safeParse({
        apiToken: "atlassian-token",
        email: "reader@example.com",
        siteUrl: "https://example.atlassian.net/",
        type: "jira",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const credentials: JiraCredentials = result.data;
        expect(credentials.siteUrl).toBe("https://example.atlassian.net");
      }
    });

    it("rejects invalid siteUrl", () => {
      const result = JiraCredentialsSchema.safeParse({
        apiToken: "atlassian-token",
        email: "reader@example.com",
        siteUrl: "not-a-url",
        type: "jira",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("VercelCredentialsSchema", () => {
    it("validates Vercel credentials", () => {
      const credentials: VercelCredentials = {
        apiToken: "vercel_api_token",
        type: "vercel",
      };

      const result = VercelCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });

    it("rejects missing API token", () => {
      const result = VercelCredentialsSchema.safeParse({
        type: "vercel",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("E2BCredentialsSchema", () => {
    it("validates E2B credentials", () => {
      const credentials: E2BCredentials = {
        apiKey: "e2b_api_key",
        type: "e2b",
      };

      const result = E2BCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });

    it("rejects missing API key", () => {
      const result = E2BCredentialsSchema.safeParse({
        type: "e2b",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("OnePasswordCredentialsSchema", () => {
    it("validates 1Password credentials", () => {
      const credentials: OnePasswordCredentials = {
        accessToken: "onepassword_connect_token",
        apiBaseUrl: "https://connect.example.com",
        type: "onepassword",
      };

      const result = OnePasswordCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });

    it("rejects missing access token", () => {
      const result = OnePasswordCredentialsSchema.safeParse({
        apiBaseUrl: "https://connect.example.com",
        type: "onepassword",
      });

      expect(result.success).toBe(false);
    });

    it("rejects invalid API base URL", () => {
      const result = OnePasswordCredentialsSchema.safeParse({
        accessToken: "onepassword_connect_token",
        apiBaseUrl: "not-a-url",
        type: "onepassword",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("MicrosoftClarityCredentialsSchema", () => {
    it("validates Microsoft Clarity credentials", () => {
      const credentials: MicrosoftClarityCredentials = {
        apiToken: "clarity_api_token",
        type: "microsoft_clarity",
      };

      const result = MicrosoftClarityCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });

    it("rejects missing API token", () => {
      const result = MicrosoftClarityCredentialsSchema.safeParse({
        type: "microsoft_clarity",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("CloudflareWebAnalyticsCredentialsSchema", () => {
    it("validates Cloudflare Web Analytics credentials", () => {
      const credentials: CloudflareWebAnalyticsCredentials = {
        accountId: "023e105f4ecef8ad9ca31a8372d0c353",
        apiToken: "cf_api_token",
        siteTag: "site_tag",
        type: "cloudflare_web_analytics",
      };

      const result =
        CloudflareWebAnalyticsCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
    });

    it("rejects missing account ID", () => {
      const result = CloudflareWebAnalyticsCredentialsSchema.safeParse({
        apiToken: "cf_api_token",
        type: "cloudflare_web_analytics",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("LinearCredentialsSchema", () => {
    it("should validate valid Linear credentials", () => {
      const credentials: LinearCredentials = {
        apiKey: "lin_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        type: "linear",
      };

      const result = LinearCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should validate valid Linear OAuth credentials", () => {
      const credentials: LinearCredentials = {
        accessToken: "lin_oauth_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        appUserId: "user_123",
        expiresAt: new Date().toISOString(),
        linearOrganizationId: "org_123",
        linearOrganizationName: "Wordbricks",
        refreshToken: "lin_refresh_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        scope: "read,write",
        tokenType: "Bearer",
        type: "linear",
      };

      const result = LinearCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(credentials);
      }
    });

    it("should treat blank optional OAuth metadata fields as undefined", () => {
      const result = LinearCredentialsSchema.safeParse({
        accessToken: "lin_oauth_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        appUserId: "   ",
        expiresAt: "   ",
        linearOrganizationId: "org_123",
        linearOrganizationName: "   ",
        refreshToken: "   ",
        scope: "   ",
        tokenType: "   ",
        type: "linear",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("linear");
        if ("apiKey" in result.data) {
          throw new Error("Expected Linear OAuth credentials");
        }
        expect(result.data.appUserId).toBeUndefined();
        expect(result.data.expiresAt).toBeUndefined();
        expect(result.data.linearOrganizationName).toBeUndefined();
        expect(result.data.refreshToken).toBeUndefined();
        expect(result.data.scope).toBeUndefined();
        expect(result.data.tokenType).toBeUndefined();
      }
    });

    it("should reject empty apiKey", () => {
      const credentials = {
        apiKey: "",
        type: "linear",
      };

      const result = LinearCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject missing apiKey", () => {
      const credentials = {
        type: "linear",
      };

      const result = LinearCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });

    it("should reject wrong type", () => {
      const credentials = {
        apiKey: "lin_api_xxx",
        type: "github",
      };

      const result = LinearCredentialsSchema.safeParse(credentials);
      expect(result.success).toBe(false);
    });
  });

  describe("credentialSchemaMap", () => {
    it("should map postgres to PostgresCredentialsSchema", () => {
      expect(credentialSchemaMap.postgres).toBe(PostgresCredentialsSchema);
    });

    it("should map mysql to MySQLCredentialsSchema", () => {
      expect(credentialSchemaMap.mysql).toBe(MySQLCredentialsSchema);
    });

    it("should map snowflake to SnowflakeCredentialsSchema", () => {
      expect(credentialSchemaMap.snowflake).toBe(SnowflakeCredentialsSchema);
    });

    it("should map mongodb to MongoDBCredentialsSchema", () => {
      expect(credentialSchemaMap.mongodb).toBe(MongoDBCredentialsSchema);
    });

    it("should map ga to GoogleAnalyticsCredentialsSchema", () => {
      expect(credentialSchemaMap.ga).toBe(GoogleAnalyticsCredentialsSchema);
    });

    it("should map bigquery to BigQueryCredentialsSchema", () => {
      expect(credentialSchemaMap.bigquery).toBe(BigQueryCredentialsSchema);
    });

    it("should map cloudflare_d1 to CloudflareD1CredentialsSchema", () => {
      expect(credentialSchemaMap.cloudflare_d1).toBe(
        CloudflareD1CredentialsSchema
      );
    });

    it("should map laminar to LaminarCredentialsSchema", () => {
      expect(credentialSchemaMap.laminar).toBe(LaminarCredentialsSchema);
    });

    it("should map motherduck to MotherDuckCredentialsSchema", () => {
      expect(credentialSchemaMap.motherduck).toBe(MotherDuckCredentialsSchema);
    });

    it("should map connector to ConnectorCredentialsSchema", () => {
      expect(credentialSchemaMap.aws_athena_connector).toBe(
        ConnectorCredentialsSchema
      );
    });

    it("should map amplitude to AmplitudeCredentialsSchema", () => {
      expect(credentialSchemaMap.amplitude).toBe(AmplitudeCredentialsSchema);
    });

    it("should map amazon_ads to AmazonAdsCredentialsSchema", () => {
      expect(credentialSchemaMap.amazon_ads).toBe(AmazonAdsCredentialsSchema);
    });

    it("should map airtable to AirtableCredentialsSchema", () => {
      expect(credentialSchemaMap.airtable).toBe(AirtableCredentialsSchema);
    });

    it("should map discord to DiscordCredentialsSchema", () => {
      expect(credentialSchemaMap.discord).toBe(DiscordCredentialsSchema);
    });

    it("should map e2b to E2BCredentialsSchema", () => {
      expect(credentialSchemaMap.e2b).toBe(E2BCredentialsSchema);
    });

    it("should map onepassword to OnePasswordCredentialsSchema", () => {
      expect(credentialSchemaMap.onepassword).toBe(
        OnePasswordCredentialsSchema
      );
    });

    it("should map slack to SlackCredentialsSchema", () => {
      expect(credentialSchemaMap.slack).toBe(SlackCredentialsSchema);
    });

    it("should map cal to CalCredentialsSchema", () => {
      expect(credentialSchemaMap.cal).toBe(CalCredentialsSchema);
    });

    it("should map confluence to ConfluenceCredentialsSchema", () => {
      expect(credentialSchemaMap.confluence).toBe(ConfluenceCredentialsSchema);
    });

    it("should map granola to GranolaCredentialsSchema", () => {
      expect(credentialSchemaMap.granola).toBe(GranolaCredentialsSchema);
    });

    it("should map google_search_console to GoogleSearchConsoleCredentialsSchema", () => {
      expect(credentialSchemaMap.google_search_console).toBe(
        GoogleSearchConsoleCredentialsSchema
      );
    });

    it("should map jira to JiraCredentialsSchema", () => {
      expect(credentialSchemaMap.jira).toBe(JiraCredentialsSchema);
    });

    it("should map linkedin_ads to LinkedInAdsCredentialsSchema", () => {
      expect(credentialSchemaMap.linkedin_ads).toBe(
        LinkedInAdsCredentialsSchema
      );
    });

    it("should map mixpanel to MixpanelCredentialsSchema", () => {
      expect(credentialSchemaMap.mixpanel).toBe(MixpanelCredentialsSchema);
    });

    it("should map posthog to PostHogCredentialsSchema", () => {
      expect(credentialSchemaMap.posthog).toBe(PostHogCredentialsSchema);
    });

    it("should map sendgrid to SendGridCredentialsSchema", () => {
      expect(credentialSchemaMap.sendgrid).toBe(SendGridCredentialsSchema);
    });

    it("should map sentry to SentryCredentialsSchema", () => {
      expect(credentialSchemaMap.sentry).toBe(SentryCredentialsSchema);
    });

    it("should map github to GitHubCredentialsSchema", () => {
      expect(credentialSchemaMap.github).toBe(GitHubCredentialsSchema);
    });

    it("should map cloudflare workers observability to CloudflareWorkersObservabilityCredentialsSchema", () => {
      expect(credentialSchemaMap.cloudflare_workers_observability).toBe(
        CloudflareWorkersObservabilityCredentialsSchema
      );
    });

    it("should map cloudflare_web_analytics to CloudflareWebAnalyticsCredentialsSchema", () => {
      expect(credentialSchemaMap.cloudflare_web_analytics).toBe(
        CloudflareWebAnalyticsCredentialsSchema
      );
    });

    it("should map linear to LinearCredentialsSchema", () => {
      expect(credentialSchemaMap.linear).toBe(LinearCredentialsSchema);
    });

    it("should map microsoft_clarity to MicrosoftClarityCredentialsSchema", () => {
      expect(credentialSchemaMap.microsoft_clarity).toBe(
        MicrosoftClarityCredentialsSchema
      );
    });

    it("should map tiktok_marketing to TikTokMarketingCredentialsSchema", () => {
      expect(credentialSchemaMap.tiktok_marketing).toBe(
        TikTokMarketingCredentialsSchema
      );
    });

    it("should map vercel to VercelCredentialsSchema", () => {
      expect(credentialSchemaMap.vercel).toBe(VercelCredentialsSchema);
    });

    it("matches supported provider keys", () => {
      expect(Object.keys(credentialSchemaMap).toSorted()).toMatchSnapshot();
    });
  });

  describe("isGitHubCredentials", () => {
    it("should return true for GitHub credentials with installationId", () => {
      const credentials: GitHubCredentials = {
        accessToken: "ghp_xxx",
        installationId: "12345",
        type: "github",
      };
      expect(isGitHubCredentials(credentials)).toBe(true);
    });
  });

  describe("isSlackCredentials", () => {
    it("should return true for Slack credentials", () => {
      const credentials: SlackCredentials = {
        botScopes: ["channels:read"],
        botToken: "xoxb-token",
        botUserId: "U123",
        teamId: "T123",
        teamName: "Acme",
        type: "slack",
      };
      expect(isSlackCredentials(credentials)).toBe(true);
    });
  });

  describe("normalizeEnvVarName", () => {
    it("matches normalized env var snapshots", () => {
      expect({
        "!@#$%": normalizeEnvVarName("!@#$%"),
        "": normalizeEnvVarName(""),
        "---prod": normalizeEnvVarName("---prod"),
        "My DB! @#$ Server": normalizeEnvVarName("My DB! @#$ Server"),
        "My GA Property": normalizeEnvVarName("My GA Property"),
        "analytics (main)": normalizeEnvVarName("analytics (main)"),
        "api.production.db": normalizeEnvVarName("api.production.db"),
        database: normalizeEnvVarName("database"),
        "db-server-01": normalizeEnvVarName("db-server-01"),
        myDatabaseServer: normalizeEnvVarName("myDatabaseServer"),
        "my-database": normalizeEnvVarName("my-database"),
        "path/to/db": normalizeEnvVarName("path/to/db"),
        "prod---": normalizeEnvVarName("prod---"),
        "prod---db": normalizeEnvVarName("prod---db"),
        "prod-db": normalizeEnvVarName("prod-db"),
        "prod_db_v2.0": normalizeEnvVarName("prod_db_v2.0"),
        データベース: normalizeEnvVarName("データベース"),
      }).toMatchSnapshot();
    });
  });

  describe("validateCredentials with all types", () => {
    it("should validate Amplitude credentials", () => {
      const credentials = {
        apiKey: "key",
        secretKey: "secret",
        type: "amplitude",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("amplitude");
    });

    it("should validate Mixpanel credentials", () => {
      const credentials = {
        projectId: "proj",
        secret: "secret",
        type: "mixpanel",
        username: "user",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("mixpanel");
    });

    it("should validate PostHog credentials", () => {
      const credentials = {
        hostUrl: "https://us.posthog.com",
        personalApiKey: "phx_valid_personal_api_key",
        projectId: "12345",
        type: "posthog",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("posthog");
    });

    it("should validate GitHub credentials", () => {
      const credentials = {
        accessToken: "ghp_xxx",
        type: "github",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("github");
    });

    it("should validate Linear credentials", () => {
      const credentials = {
        apiKey: "lin_api_xxx",
        type: "linear",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("linear");
    });

    it("should validate Connector credentials", () => {
      const credentials = {
        connectorId: "connector_123",
        database: "analytics",
        type: "aws_athena_connector",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("aws_athena_connector");
    });

    it("should validate MotherDuck credentials", () => {
      const credentials = {
        token: "md_token",
        type: "motherduck",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("motherduck");
    });

    it("should validate Cloudflare D1 credentials", () => {
      const credentials = {
        accountId: "023e105f4ecef8ad9ca31a8372d0c353",
        apiToken: "cf_api_token",
        databaseId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        type: "cloudflare_d1",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("cloudflare_d1");
    });

    it("should validate Sentry credentials", () => {
      const credentials = {
        authToken: "sntrys_123",
        organizationSlug: "acme",
        projectSlug: "frontend",
        type: "sentry",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("sentry");
    });

    it("should validate LinkedIn Ads credentials", () => {
      const credentials = {
        accessToken: "linkedin-token",
        type: "linkedin_ads",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("linkedin_ads");
    });

    it("should validate TikTok Marketing credentials", () => {
      const credentials = {
        accessToken: "tiktok-token",
        type: "tiktok_marketing",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("tiktok_marketing");
    });

    it("should validate SendGrid credentials", () => {
      const credentials = {
        apiKey: "SG.xxxxx",
        type: "sendgrid",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("sendgrid");
    });

    it("should validate Microsoft Clarity credentials", () => {
      const credentials = {
        apiToken: "clarity_api_token",
        type: "microsoft_clarity",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("microsoft_clarity");
    });

    it("should validate 1Password credentials", () => {
      const credentials = {
        accessToken: "onepassword_connect_token",
        apiBaseUrl: "https://connect.example.com",
        type: "onepassword",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("onepassword");
    });

    it("should validate Cloudflare Web Analytics credentials", () => {
      const credentials = {
        accountId: "023e105f4ecef8ad9ca31a8372d0c353",
        apiToken: "cf_api_token",
        type: "cloudflare_web_analytics",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("cloudflare_web_analytics");
    });

    it("should validate MongoDB credentials", () => {
      const credentials = {
        connectionString: "mongodb://user:pass@localhost:27017/admin",
        type: "mongodb",
      };

      const result = validateCredentials(credentials);
      expect(result.type).toBe("mongodb");
    });

    it("should throw on unknown credential type", () => {
      const credentials = {
        apiKey: "key",
        type: "unknown_provider",
      };

      expect(() => validateCredentials(credentials)).toThrow();
    });
  });

  describe("type guards with all credential types", () => {
    it("should correctly identify all OAuth credentials", () => {
      const allCredentials: Credentials[] = [
        {
          database: "db",
          host: "localhost",
          password: "pass",
          port: 5432,
          sslMode: "prefer",
          type: "postgres",
          username: "user",
        },
        {
          database: "db",
          host: "localhost",
          password: "pass",
          port: 3306,
          sslMode: "prefer",
          type: "mysql",
          username: "user",
        },
        {
          account: "xy12345.us-east-1",
          database: "ANALYTICS",
          password: "secret",
          schema: "PUBLIC",
          type: "snowflake",
          username: "ONEQUERY_READER",
          warehouse: "ANALYTICS_WH",
        },
        {
          connectionString: "mongodb://user:pass@localhost:27017/admin",
          type: "mongodb",
        },
        {
          accessToken: "token",
          expiresAt: Date.now(),
          propertyId: "prop",
          refreshToken: "refresh",
          type: "ga",
        },
        {
          accessToken: "token",
          expiresAt: Date.now(),
          projectId: "proj",
          refreshToken: "refresh",
          type: "bigquery",
        },
        {
          accountId: "023e105f4ecef8ad9ca31a8372d0c353",
          apiToken: "cf_api_token",
          databaseId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
          type: "cloudflare_d1",
        },
        {
          apiKey: "lmnr_project_key_123",
          type: "laminar",
        },
        {
          database: "md:",
          host: "pg.us-east-1-aws.motherduck.com",
          port: 5432,
          token: "md_token",
          type: "motherduck",
          username: "postgres",
        },
        {
          connectorId: "connector_123",
          database: "analytics",
          type: "aws_athena_connector",
        },
        {
          apiKey: "key",
          region: "us",
          secretKey: "secret",
          type: "amplitude",
        },
        {
          projectId: "proj",
          region: "us",
          secret: "secret",
          type: "mixpanel",
          username: "user",
        },
        {
          hostUrl: "https://us.posthog.com",
          personalApiKey: "phx_valid_personal_api_key",
          projectId: "12345",
          type: "posthog",
        },
        {
          authToken: "sntrys_123",
          organizationSlug: "acme",
          projectSlug: "frontend",
          type: "sentry",
        },
        {
          accessToken: "ghp_xxx",
          type: "github",
        },
        {
          apiKey: "lin_api_xxx",
          type: "linear",
        },
      ];

      const oauthCreds = allCredentials.filter(isOAuthCredentials);
      expect(oauthCreds.map((c) => c.type).toSorted()).toEqual(
        ["bigquery", "ga"].toSorted()
      );

      const dbCreds = allCredentials.filter(isDatabaseCredentials);
      expect(dbCreds.map((c) => c.type).toSorted()).toEqual(
        [
          "bigquery",
          "aws_athena_connector",
          "cloudflare_d1",
          "laminar",
          "motherduck",
          "mysql",
          "postgres",
          "snowflake",
        ].toSorted()
      );

      const analyticsCreds = allCredentials.filter(isAnalyticsCredentials);
      expect(analyticsCreds.map((c) => c.type).toSorted()).toEqual(
        ["amplitude", "mixpanel", "posthog"].toSorted()
      );

      const githubCreds = allCredentials.filter(isGitHubCredentials);
      expect(githubCreds.map((c) => c.type)).toEqual(["github"]);

      const linearCreds = allCredentials.filter(isLinearCredentials);
      expect(linearCreds.map((c) => c.type)).toEqual(["linear"]);
    });
  });
});
