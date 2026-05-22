/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare" />
/// <reference types="vite/client" />
/// <reference types="react/canary" />
/// <reference types="react-dom/canary" />

declare namespace Cloudflare {
  interface Env {
    LANDING_SLACK_WEBHOOK_URL?: string;
  }
}
