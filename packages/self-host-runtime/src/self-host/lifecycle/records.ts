import { Result } from "better-result";
import type { Result as ResultType } from "better-result";
import { z } from "zod";

import { RuntimeLockRecordReadError } from "./errors";
import type {
  RuntimeLifecyclePhase,
  RuntimeLockRecord,
  RuntimeStateRecord,
} from "./types";

export const runtimeLaunchIdSchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "runtime launchId must not be empty",
  });

const runtimeLockRecordSchema = z
  .object({
    acquiredAt: z.iso.datetime(),
    dataDir: z.string().min(1),
    launchId: runtimeLaunchIdSchema,
    pid: z.number().int().positive(),
  })
  .strict();

export function createRuntimeStateRecord(
  lockRecord: RuntimeLockRecord,
  phase: RuntimeLifecyclePhase,
  now: () => Date
): RuntimeStateRecord {
  return {
    pid: lockRecord.pid,
    phase,
    updatedAt: now().toISOString(),
    dataDir: lockRecord.dataDir,
    launchId: lockRecord.launchId,
  };
}

export function decodeRuntimeLockRecord(
  value: unknown,
  path: string
): ResultType<RuntimeLockRecord, RuntimeLockRecordReadError> {
  const parsed = runtimeLockRecordSchema.safeParse(value);
  if (!parsed.success) {
    return Result.err(
      new RuntimeLockRecordReadError({
        cause: parsed.error,
        message: `invalid runtime lock record at ${path}`,
        path,
      })
    );
  }

  return Result.ok(parsed.data);
}
