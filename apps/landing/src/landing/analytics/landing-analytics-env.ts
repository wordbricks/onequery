import { PUBLIC_GOOGLE_TAG_MANAGER_ID } from "astro:env/client";

import type { GoogleTagManagerEnv } from "./google-tag-manager-config";

export const landingAnalyticsEnv = {
  PUBLIC_GOOGLE_TAG_MANAGER_ID,
} satisfies GoogleTagManagerEnv;
