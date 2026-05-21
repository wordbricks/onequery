import type { ComponentPropsWithoutRef } from "react";
import {
  siGithub,
  siGooglebigquery,
  siGoogledrive,
  siLinear,
  siMongodb,
  siMysql,
  siNotion,
  siPostgresql,
  siSnowflake,
} from "simple-icons";

const BRAND_ICONS = {
  bigquery: siGooglebigquery,
  github: siGithub,
  googledrive: siGoogledrive,
  linear: siLinear,
  mongodb: siMongodb,
  mysql: siMysql,
  notion: siNotion,
  postgresql: siPostgresql,
  snowflake: siSnowflake,
} as const;

export type BrandIconName = keyof typeof BRAND_ICONS;

type BrandIconProps = Omit<
  ComponentPropsWithoutRef<"svg">,
  "children" | "viewBox"
> & {
  name: BrandIconName;
  title?: string;
};

export function BrandIcon({
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  name,
  role,
  title,
  ...props
}: BrandIconProps) {
  const icon = BRAND_ICONS[name];
  const isHidden = ariaHidden === true || ariaHidden === "true";

  return (
    <svg
      {...props}
      aria-hidden={ariaHidden}
      aria-label={isHidden ? undefined : (ariaLabel ?? title ?? icon.title)}
      role={isHidden ? undefined : (role ?? "img")}
      viewBox="0 0 24 24"
    >
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}
