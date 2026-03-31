import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ServerLaunchConfig } from "@onequery/config/server-launch";
import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);
const optionalStringSchema = nonEmptyStringSchema.optional();
const portSchema = z.number().int().min(1).max(65535);
const originSchema = z.string().trim().url();

const serverLaunchRuntimePathsSchema = z.object({
  backupsDir: nonEmptyStringSchema,
  dataDir: nonEmptyStringSchema,
  lockPath: nonEmptyStringSchema,
  logsDir: nonEmptyStringSchema,
  pidPath: nonEmptyStringSchema,
  runDir: nonEmptyStringSchema,
});

const serverLaunchStorageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("postgres"),
    url: nonEmptyStringSchema,
  }),
  z.object({
    dir: nonEmptyStringSchema,
    kind: z.literal("pglite"),
  }),
]);

const serverLaunchSmtpSchema = z.object({
  fromEmail: nonEmptyStringSchema,
  fromName: optionalStringSchema,
  host: nonEmptyStringSchema,
  password: optionalStringSchema,
  port: portSchema,
  secure: z.boolean().optional(),
  username: optionalStringSchema,
});

const serverLaunchConfigSchema = z
  .object({
    assets: z.object({
      distDir: nonEmptyStringSchema,
    }),
    auth: z.object({
      secret: nonEmptyStringSchema,
    }),
    connectors: z.object({
      enrollmentToken: nonEmptyStringSchema,
    }),
    crypto: z.object({
      masterEncryptionKey: nonEmptyStringSchema,
    }),
    listen: z.object({
      host: nonEmptyStringSchema,
      port: portSchema,
    }),
    mode: z.enum(["workspace-dev", "self-host"]),
    publicOrigin: originSchema,
    rateLimit: z.object({
      enabled: z.boolean(),
      storage: z.enum(["memory", "persistent"]),
    }),
    runtimePaths: serverLaunchRuntimePathsSchema.optional(),
    smtp: serverLaunchSmtpSchema.optional(),
    storage: serverLaunchStorageSchema,
  })
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

function buildLaunchConfigError(source: string, error: z.ZodError): Error {
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

export function validateLaunchConfig(
  value: unknown,
  source: string
): ServerLaunchConfig {
  const parsed = serverLaunchConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw buildLaunchConfigError(source, parsed.error);
  }

  return parsed.data;
}

export function loadLaunchConfigFile(path: string): ServerLaunchConfig {
  const resolvedPath = resolve(path);
  let contents: string;

  try {
    contents = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read launch config file: ${resolvedPath}\n${(error as Error).message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Invalid launch config JSON: ${resolvedPath}\n${(error as Error).message}`
    );
  }

  return validateLaunchConfig(parsed, `file ${resolvedPath}`);
}
