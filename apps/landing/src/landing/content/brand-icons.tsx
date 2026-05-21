import { SimpleIconSvg } from "@onequery/ui/icons/svg-icon";
import type { IconSvgProps } from "@onequery/ui/icons/svg-icon";
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

type BrandIconProps = IconSvgProps & {
  name: BrandIconName;
};

export function BrandIcon({ name, ...props }: BrandIconProps) {
  const icon = BRAND_ICONS[name];

  return <SimpleIconSvg {...props} icon={icon} />;
}
