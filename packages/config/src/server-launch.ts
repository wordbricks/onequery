import { z } from "zod";

// Canonical launch-contract owner: Rust emits JSON to match this module, and
// Bun validates/consumes it only through @onequery/config/server-launch.
const nonEmptyStringSchema = z.string().trim().min(1);
const optionalStringSchema = nonEmptyStringSchema.optional();
const portSchema = z.number().int().min(1).max(65535);
const originSchema = z.string().trim().url();
const MASTER_ENCRYPTION_KEY_BYTE_LENGTH = 32;

function decodeMasterEncryptionKeyValue(value: string): Uint8Array {
  const normalizedValue = value.trim();
  let decodedValue: string;

  try {
    decodedValue = atob(normalizedValue);
  } catch {
    throw new Error(
      "Master encryption key must be valid base64 that decodes to exactly 32 bytes."
    );
  }

  if (decodedValue.length !== MASTER_ENCRYPTION_KEY_BYTE_LENGTH) {
    throw new Error(
      "Master encryption key must be valid base64 that decodes to exactly 32 bytes."
    );
  }

  return Uint8Array.from(decodedValue, (char) => char.charCodeAt(0));
}

export function decodeMasterEncryptionKey(value: string): Uint8Array {
  return decodeMasterEncryptionKeyValue(value);
}

const masterEncryptionKeySchema = nonEmptyStringSchema.superRefine(
  (value, context) => {
    try {
      decodeMasterEncryptionKeyValue(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid master encryption key.",
      });
    }
  }
);

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
        secret: nonEmptyStringSchema,
      })
      .strict(),
    connectors: z
      .object({
        enrollmentToken: nonEmptyStringSchema,
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
        enabled: z.boolean(),
        storage: z.enum(["memory", "persistent"]),
      })
      .strict(),
    runtimePaths: serverLaunchRuntimePathsSchema.optional(),
    smtp: serverLaunchSmtpSchema.optional(),
    storage: serverLaunchStorageSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.rateLimit.storage === "persistent" && !value.runtimePaths) {
      context.addIssue({
        code: "custom",
        message: "Persistent rate limiting requires runtimePaths.",
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
