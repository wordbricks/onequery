import { SvgIcon } from "./svg-icon";
import type { IconSvgProps } from "./svg-icon";

export function SendGridIcon({ size = 24, ...props }: IconSvgProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel="SendGrid"
      size={size}
      viewBox="0 0 512 512"
    >
      <path d="M512 0v341.3H341.3V512H0V170.7h170.7V0z" fill="#9DD6E3" />
      <path d="M0 512h170.7V341.3H0z" fill="#3F72AB" />
      <path
        d="M341.3 341.3H512V170.7H341.3zM170.7 170.7h170.6V0H170.7z"
        fill="#00A9D1"
      />
      <path d="M170.7 341.3h170.6V170.7H170.7z" fill="#2191C4" />
      <path d="M341.3 170.7H512V0H341.3z" fill="#3F72AB" />
    </SvgIcon>
  );
}
