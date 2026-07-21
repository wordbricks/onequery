import { SvgIcon } from "./svg-icon";
import type { IconSvgProps } from "./svg-icon";

export const JAM_LOGO_URL =
  "https://storage.googleapis.com/jam-assets/jam-logo.webp";

export function JamIcon({ size = 24, ...props }: IconSvgProps) {
  return (
    <SvgIcon {...props} defaultLabel="Jam" size={size} viewBox="0 0 384 384">
      <image
        height="384"
        href={JAM_LOGO_URL}
        preserveAspectRatio="xMidYMid meet"
        width="384"
      />
    </SvgIcon>
  );
}
