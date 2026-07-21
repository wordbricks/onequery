import { SvgIcon } from "./svg-icon";
import type { IconSvgProps } from "./svg-icon";

export const E2B_LOGO_URL =
  "https://raw.githubusercontent.com/e2b-dev/E2B/main/readme-assets/logo-black.png";

export function E2BIcon({ size = 24, ...props }: IconSvgProps) {
  return (
    <SvgIcon {...props} defaultLabel="E2B" size={size} viewBox="0 0 1117 500">
      <image
        height="500"
        href={E2B_LOGO_URL}
        preserveAspectRatio="xMidYMid meet"
        width="1117"
      />
    </SvgIcon>
  );
}
