import { createFileRoute } from "@tanstack/react-router";

import { deviceSearchValidator } from "@/features/device-auth/device-auth-schema";
import { DEVICE_ROUTE } from "@/lib/app-routes";
import { DeviceAuthPage } from "@/pages/device-auth-page";

export const Route = createFileRoute(DEVICE_ROUTE)({
  component: DeviceAuthPage,
  validateSearch: deviceSearchValidator,
});
