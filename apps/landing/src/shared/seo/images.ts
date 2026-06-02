import { ONEQUERY } from "./constants";
import type { ShareImage } from "./constants";
import { toAbsoluteSiteUrl } from "./schema";

type SiteInput = string | URL | null | undefined;

export function getOneQueryShareImage(site?: SiteInput): ShareImage {
  return {
    ...ONEQUERY.IMAGES.SHARE,
    url: toAbsoluteSiteUrl(ONEQUERY.IMAGES.SHARE.url, site),
  };
}
