import { normalizeDeviceUserCode } from "@onequery/base/device-auth";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { sanitizeOnboardingOrganizationId } from "@/lib/onboarding-organization-id";

const deviceSearchSchema = z.object({
  orgId: z
    .string()
    .optional()
    .transform((value) => sanitizeOnboardingOrganizationId(value)),
  user_code: z
    .string()
    .optional()
    .transform((value) => normalizeDeviceUserCode(value)),
});

export const deviceSearchValidator = zodValidator(deviceSearchSchema);
