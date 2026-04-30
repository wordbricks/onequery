import { useDeviceAuthController } from "./device-auth-controller";
import { DeviceAuthView } from "./device-auth-view";

export function DeviceAuthFeature() {
  const controller = useDeviceAuthController();

  return <DeviceAuthView controller={controller} />;
}
