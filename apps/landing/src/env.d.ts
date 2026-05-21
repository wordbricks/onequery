/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GA_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace Cloudflare {
  interface Env {
    LANDING_SLACK_WEBHOOK_URL?: string;
  }
}
