// This is a Google tag / GA4 measurement ID, not a GTM container ID.
export const GOOGLE_TAG_ID = "G-TVPWK9V4TE";
export const GOOGLE_TAG_DOMAIN = "https://www.googletagmanager.com";
export const GOOGLE_TAG_SCRIPT = "gtag/js";

export type GoogleTagConfig = {
  readonly domain: string;
  readonly id: string;
  readonly script: string;
};

export const googleTagConfig = {
  domain: GOOGLE_TAG_DOMAIN,
  id: GOOGLE_TAG_ID,
  script: GOOGLE_TAG_SCRIPT,
} satisfies GoogleTagConfig;
