import { z } from "zod";

import {
  authSecretSchema,
  connectorEnrollmentTokenSchema,
  decodeMasterEncryptionKey,
  masterEncryptionKeySchema,
} from "./shared-secrets";

export { decodeMasterEncryptionKey } from "./shared-secrets";

// Canonical launch-contract owner: Rust emits JSON to match this module, and
// Bun validates/consumes it only through @onequery/config/server-launch.
const nonEmptyStringSchema = z.string().trim().min(1);
const optionalStringSchema = nonEmptyStringSchema.optional();
const portSchema = z.number().int().min(1).max(65535);
const originSchema = z.string().trim().pipe(z.url());

export const serverLaunchRuntimePathsSchema = z
  .object({
    backupsDir: nonEmptyStringSchema,
    dataDir: nonEmptyStringSchema,
    lockPath: nonEmptyStringSchema,
    logsDir: nonEmptyStringSchema,
    pidPath: nonEmptyStringSchema,
    runDir: nonEmptyStringSchema,
  })
  .strict();

export const serverLaunchMigrationsSchema = z
  .object({
    dir: nonEmptyStringSchema,
  })
  .strict();

export const serverLaunchStorageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("postgres"),
      url: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      dir: nonEmptyStringSchema,
      kind: z.literal("pglite"),
    })
    .strict(),
]);

export const serverLaunchSmtpSchema = z
  .object({
    fromEmail: nonEmptyStringSchema,
    fromName: optionalStringSchema,
    host: nonEmptyStringSchema,
    password: optionalStringSchema,
    port: portSchema,
    secure: z.boolean().optional(),
    username: optionalStringSchema,
  })
  .strict();

export const serverLaunchConfigSchema = z
  .object({
    assets: z
      .object({
        distDir: nonEmptyStringSchema,
      })
      .strict(),
    auth: z
      .object({
        secret: authSecretSchema,
      })
      .strict(),
    connectors: z
      .object({
        enrollmentToken: connectorEnrollmentTokenSchema,
      })
      .strict(),
    crypto: z
      .object({
        masterEncryptionKey: masterEncryptionKeySchema,
      })
      .strict(),
    listen: z
      .object({
        host: nonEmptyStringSchema,
        port: portSchema,
      })
      .strict(),
    migrations: serverLaunchMigrationsSchema,
    mode: z.enum(["workspace-dev", "self-host"]),
    publicOrigin: originSchema,
    rateLimit: z
      .object({
        api: z
          .object({
            storage: z.enum(["memory", "persistent"]),
          })
          .strict(),
        enabled: z.boolean(),
      })
      .strict(),
    runtimePaths: serverLaunchRuntimePathsSchema.optional(),
    smtp: serverLaunchSmtpSchema.optional(),
    storage: serverLaunchStorageSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.rateLimit.api.storage === "persistent" && !value.runtimePaths) {
      context.addIssue({
        code: "custom",
        message: "Persistent API rate limiting requires runtimePaths.",
        path: ["runtimePaths"],
      });
    }

    if (value.mode === "self-host" && !value.runtimePaths) {
      context.addIssue({
        code: "custom",
        message: "Self-host launch config requires runtimePaths.",
        path: ["runtimePaths"],
      });
    }
  });

export type ServerLaunchConfig = z.infer<typeof serverLaunchConfigSchema>;
export type ServerLaunchSmtpConfig = z.infer<typeof serverLaunchSmtpSchema>;

function buildServerLaunchConfigError(
  source: string,
  error: z.ZodError
): Error {
  const issues = error.issues.map((issue) => {
    const path =
      issue.path.length === 0
        ? "(root)"
        : issue.path.map((entry) => String(entry)).join(".");
    return `- ${path}: ${issue.message}`;
  });

  return new Error(
    [`Invalid launch config from ${source}.`, ...issues].join("\n")
  );
}

export function validateServerLaunchConfig(
  value: unknown,
  source: string
): ServerLaunchConfig {
  const parsed = serverLaunchConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw buildServerLaunchConfigError(source, parsed.error);
  }

  return parsed.data;
}
