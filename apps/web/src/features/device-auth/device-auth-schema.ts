import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

const DEVICE_USER_CODE_LENGTH = 8;

const DEVICE_USER_CODE_PATTERN = new RegExp(
  `^[A-Z0-9]{${DEVICE_USER_CODE_LENGTH}}$`
);

export function normalizeDeviceUserCode(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim().replaceAll("-", "").toUpperCase();
  if (!normalized || !DEVICE_USER_CODE_PATTERN.test(normalized)) {
    return undefined;
  }

  return normalized;
}

const deviceSearchSchema = z.object({
  user_code: z
    .string()
    .optional()
    .transform((value) => normalizeDeviceUserCode(value)),
});

export const deviceSearchValidator = zodValidator(deviceSearchSchema);
