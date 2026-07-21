import { SvgIcon } from "./svg-icon";
import type { IconSvgProps } from "./svg-icon";

export const MICROSOFT_CLARITY_ICON_URL =
  "https://clarity.microsoft.com/blog/wp-content/uploads/2025/02/siteIcon.png";

export function MicrosoftClarityIcon({ size = 24, ...props }: IconSvgProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="Microsoft Clarity"
      size={size}
      viewBox="0 0 256 256"
    >
      <image
        height="256"
        href={MICROSOFT_CLARITY_ICON_URL}
        preserveAspectRatio="xMidYMid meet"
        width="256"
      />
    </SvgIcon>
  );
}
