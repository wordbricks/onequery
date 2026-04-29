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
    lifecycleEventLogPath: nonEmptyStringSchema,
    logsDir: nonEmptyStringSchema,
    runDir: nonEmptyStringSchema,
    runtimeLeasePath: nonEmptyStringSchema,
    runtimeStatusSnapshotPath: nonEmptyStringSchema,
  })
  .strict();

const positiveUint64StringSchema = z
  .string()
  .regex(/^(?:[1-9][0-9]*)$/, "Expected a positive uint64 decimal string.")
  .refine((value) => {
    try {
      return BigInt(value) <= 18_446_744_073_709_551_615n;
    } catch {
      return false;
    }
  }, "Expected a uint64 decimal string.");

export const serverLaunchSupervisorSchema = z
  .object({
    generation: positiveUint64StringSchema,
    pid: z.number().int().min(1).max(4_294_967_295),
    supervisorId: nonEmptyStringSchema,
  })
  .strict();

export const serverLaunchSupervisorControlTransportSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("unix"),
        socketPath: nonEmptyStringSchema,
      })
      .strict(),
  ]);

export const serverLaunchSupervisorControlSchema = z
  .object({
    baseUrl: originSchema,
    maxMessageBytes: z.number().int().min(1).max(0xffffffff),
    transport: serverLaunchSupervisorControlTransportSchema,
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
    launchId: nonEmptyStringSchema.optional(),
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
    supervisorControl: serverLaunchSupervisorControlSchema.optional(),
    supervisor: serverLaunchSupervisorSchema.optional(),
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

    if (value.mode === "self-host" && !value.supervisorControl) {
      context.addIssue({
        code: "custom",
        message: "Self-host launch config requires supervisorControl.",
        path: ["supervisorControl"],
      });
    }

    if (value.mode === "self-host" && !value.launchId) {
      context.addIssue({
        code: "custom",
        message: "Self-host launch config requires launchId.",
        path: ["launchId"],
      });
    }

    if (value.mode === "self-host" && !value.supervisor) {
      context.addIssue({
        code: "custom",
        message: "Self-host launch config requires supervisor.",
        path: ["supervisor"],
      });
    }
  });

export type ServerLaunchConfig = z.infer<typeof serverLaunchConfigSchema>;
export type ServerLaunchSupervisorControlConfig = z.infer<
  typeof serverLaunchSupervisorControlSchema
>;
export type ServerLaunchSupervisorControlTransportConfig = z.infer<
  typeof serverLaunchSupervisorControlTransportSchema
>;
export type ServerLaunchSmtpConfig = z.infer<typeof serverLaunchSmtpSchema>;
export type ServerLaunchSupervisorConfig = z.infer<
  typeof serverLaunchSupervisorSchema
>;

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
