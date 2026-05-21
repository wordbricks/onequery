import {
  IconDatabase,
  IconFlask,
  IconGitBranch,
  IconShieldCheck,
} from "@tabler/icons-react";

type BlogIconProps = {
  className?: string;
};

const BLOG_ICON_STROKE = 1.7;

export function DatabaseIcon({ className }: BlogIconProps) {
  return (
    <IconDatabase
      aria-hidden="true"
      className={className}
      stroke={BLOG_ICON_STROKE}
    />
  );
}

export function FlaskIcon({ className }: BlogIconProps) {
  return (
    <IconFlask
      aria-hidden="true"
      className={className}
      stroke={BLOG_ICON_STROKE}
    />
  );
}

export function GitBranchIcon({ className }: BlogIconProps) {
  return (
    <IconGitBranch
      aria-hidden="true"
      className={className}
      stroke={BLOG_ICON_STROKE}
    />
  );
}

export function ShieldIcon({ className }: BlogIconProps) {
  return (
    <IconShieldCheck
      aria-hidden="true"
      className={className}
      stroke={BLOG_ICON_STROKE}
    />
  );
}
