import { loadConfigFromSourcesSync } from "@onequery/config";
import { z } from "zod";

import type { AuthEmailDeliveryConfig } from "./lib/email-delivery";
import type { RuntimeRateLimitStorage } from "./lib/rate-limit-storage";

export interface AuthEnv {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DATABASE_URL?: string;
  /** Disable auth and API rate limits for local development or e2e */
  DISABLE_RATE_LIMIT?: boolean | string;
  SMTP_FROM_EMAIL?: string;
  SMTP_FROM_NAME?: string;
  SMTP_HOST?: string;
  SMTP_PASSWORD?: string;
  SMTP_PORT?: number | string;
  SMTP_SECURE?: boolean | string;
  SMTP_USERNAME?: string;
  RATE_LIMIT_STORAGE?: RuntimeRateLimitStorage;
}

export interface ServerEnv extends AuthEnv {
  MASTER_ENCRYPTION_KEY: string;
  /** Enrollment token used by connector register endpoint */
  CONNECTOR_ENROLLMENT_TOKEN?: string;
  WEB_URL: string;
}

const nonEmptyStringSchema = z.string().trim().min(1);

const optionalNonEmptyStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, nonEmptyStringSchema.optional());

const booleanFlagSchema = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false" || normalized.length === 0) {
      return false;
    }
  }

  return value;
}, z.boolean().optional());

const optionalPortSchema = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return undefined;
    }

    return Number.parseInt(normalized, 10);
  }

  return value;
}, z.number().int().positive().optional());

const databaseEnvSchema = z
  .object({
    DATABASE_URL: optionalNonEmptyStringSchema,
  })
  .superRefine((value, context) => {
    if (value.DATABASE_URL) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: "No database connection: DATABASE_URL required",
      path: ["DATABASE_URL"],
    });
  });

const authEnvSchema = databaseEnvSchema
  .extend({
    BETTER_AUTH_SECRET: nonEmptyStringSchema,
    BETTER_AUTH_URL: z.string().trim().url(),
    DISABLE_RATE_LIMIT: booleanFlagSchema,
    RATE_LIMIT_STORAGE: z.unknown().optional(),
    SMTP_FROM_EMAIL: optionalNonEmptyStringSchema,
    SMTP_FROM_NAME: optionalNonEmptyStringSchema,
    SMTP_HOST: optionalNonEmptyStringSchema,
    SMTP_PASSWORD: optionalNonEmptyStringSchema,
    SMTP_PORT: optionalPortSchema,
    SMTP_SECURE: booleanFlagSchema,
    SMTP_USERNAME: optionalNonEmptyStringSchema,
  })
  .superRefine((value, context) => {
    const hasSmtpField =
      value.SMTP_HOST !== undefined ||
      value.SMTP_PORT !== undefined ||
      value.SMTP_FROM_EMAIL !== undefined ||
      value.SMTP_FROM_NAME !== undefined ||
      value.SMTP_USERNAME !== undefined ||
      value.SMTP_PASSWORD !== undefined ||
      value.SMTP_SECURE !== undefined;

    if (!hasSmtpField) {
      return;
    }

    if (!value.SMTP_HOST) {
      context.addIssue({
        code: "custom",
        message: "SMTP_HOST is required when SMTP delivery is configured",
        path: ["SMTP_HOST"],
      });
    }

    if (!value.SMTP_PORT) {
      context.addIssue({
        code: "custom",
        message: "SMTP_PORT is required when SMTP delivery is configured",
        path: ["SMTP_PORT"],
      });
    }

    if (!value.SMTP_FROM_EMAIL) {
      context.addIssue({
        code: "custom",
        message: "SMTP_FROM_EMAIL is required when SMTP delivery is configured",
        path: ["SMTP_FROM_EMAIL"],
      });
    }

    const hasUsername = value.SMTP_USERNAME !== undefined;
    const hasPassword = value.SMTP_PASSWORD !== undefined;
    if (hasUsername !== hasPassword) {
      context.addIssue({
        code: "custom",
        message:
          "SMTP_USERNAME and SMTP_PASSWORD must both be set when SMTP auth is configured",
        path: ["SMTP_USERNAME"],
      });
    }
  });

const coreServerEnvSchema = databaseEnvSchema.extend({
  BETTER_AUTH_SECRET: nonEmptyStringSchema,
  BETTER_AUTH_URL: z.string().trim().url(),
  DISABLE_RATE_LIMIT: booleanFlagSchema,
});

function resolveParsedConnectionString(
  parsed: z.infer<typeof databaseEnvSchema>
): string {
  const connectionString = parsed.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Invariant: database env parsing succeeded without a connection string"
    );
  }

  return connectionString;
}

export function parseBooleanEnvFlag(value: unknown): boolean {
  return booleanFlagSchema.parse(value) ?? false;
}

export function parseDatabaseEnv(env: Pick<ServerEnv, "DATABASE_URL">) {
  const parsed = loadConfigFromSourcesSync({
    env,
    schema: databaseEnvSchema,
  });

  return {
    connectionString: resolveParsedConnectionString(parsed),
  };
}

export function parseCoreServerEnv(
  env: Pick<
    ServerEnv,
    | "BETTER_AUTH_SECRET"
    | "BETTER_AUTH_URL"
    | "DATABASE_URL"
    | "DISABLE_RATE_LIMIT"
  >
) {
  const parsed = loadConfigFromSourcesSync({
    env,
    schema: coreServerEnvSchema,
  });

  return {
    baseUrl: parsed.BETTER_AUTH_URL,
    connectionString: resolveParsedConnectionString(parsed),
    disableRateLimit: parsed.DISABLE_RATE_LIMIT ?? false,
    secret: parsed.BETTER_AUTH_SECRET,
  };
}

export function parseAuthEnv(env: AuthEnv) {
  const parsed = loadConfigFromSourcesSync({
    env,
    schema: authEnvSchema,
  });

  return {
    baseURL: parsed.BETTER_AUTH_URL,
    databaseUrl: resolveParsedConnectionString(parsed),
    disableRateLimit: parsed.DISABLE_RATE_LIMIT ?? false,
    emailDelivery: resolveEmailDelivery(parsed),
    rateLimitStorage:
      parsed.RATE_LIMIT_STORAGE as AuthEnv["RATE_LIMIT_STORAGE"],
    secret: parsed.BETTER_AUTH_SECRET,
  };
}

function resolveEmailDelivery(
  parsed: z.infer<typeof authEnvSchema>
): AuthEmailDeliveryConfig {
  if (!parsed.SMTP_HOST || !parsed.SMTP_PORT || !parsed.SMTP_FROM_EMAIL) {
    return {
      baseURL: parsed.BETTER_AUTH_URL,
    };
  }

  return {
    baseURL: parsed.BETTER_AUTH_URL,
    smtp: {
      fromEmail: parsed.SMTP_FROM_EMAIL,
      fromName: parsed.SMTP_FROM_NAME,
      host: parsed.SMTP_HOST,
      password: parsed.SMTP_PASSWORD,
      port: parsed.SMTP_PORT,
      secure: parsed.SMTP_SECURE ?? false,
      username: parsed.SMTP_USERNAME,
    },
  };
}

/**
 * Get OAuth redirect base URL from request origin.
 * @param requestUrl - The full request URL
 * @param forwardedProto - Value of X-Forwarded-Proto header from reverse proxy (upgrades to HTTPS if "https")
 */
export function getOAuthRedirectBase(
  requestUrl: string,
  forwardedProto?: string
): string {
  const url = new URL(requestUrl);
  // If X-Forwarded-Proto indicates https (from reverse proxy), upgrade the protocol
  // Handle case-insensitive comparison and comma-separated values (e.g., "https, http")
  if (forwardedProto?.toLowerCase().startsWith("https")) {
    url.protocol = "https:";
  }
  return url.origin;
}

/** Get database connection string from Hyperdrive (production) or DATABASE_URL (local dev) */
export function getConnectionString(
  env: Pick<ServerEnv, "DATABASE_URL">
): string {
  return parseDatabaseEnv(env).connectionString;
}
