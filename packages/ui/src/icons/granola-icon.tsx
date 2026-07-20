import { SvgIcon } from "./svg-icon";
import type { IconSvgProps } from "./svg-icon";

export function GranolaIcon({ size = 24, ...props }: IconSvgProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="Granola"
      size={size}
      viewBox="0 0 550 550"
    >
      <rect fill="#B2C248" height="550" rx="60" width="550" />
      <path
        d="M402 125c-70-31-160-19-226 27-75 52-101 134-74 211 25 72 92 113 178 112 83-1 150-43 177-110 29-72 0-151-69-191-65-37-151-27-198 24-43 47-46 113-7 154 43 45 120 48 167 7 40-35 45-93 11-128-32-33-90-36-124-6-29 25-34 69-10 94"
        fill="none"
        stroke="#1E1E1E"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="42"
      />
      <circle cx="291" cy="310" fill="#1E1E1E" r="42" />
    </SvgIcon>
  );
}
