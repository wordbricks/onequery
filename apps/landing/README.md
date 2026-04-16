# Landing On Cloudflare Workers

This app is a Vite SPA served by a Cloudflare Worker. It builds static assets to
`apps/landing/dist/client`, and the Worker serves those assets plus the public
marketing ingest endpoints:

- `POST /api/product-updates`
- `POST /api/contact`

## Build Settings

- Git provider: GitHub
- Production branch: `main`
- Root directory: `.`
- Build command: `bun run landing:build`
- Environment: `BUN_VERSION=1.3.10`, `NODE_VERSION=22`
- Worker name: `onequery-landing`

Keep the build at repo root. `bun run landing:build` already includes the
installer asset from `packages/self-host-runtime`.

## Domain

Attach your custom domain to the `onequery-landing` Worker in Cloudflare. The
public installer URL is expected to stay `https://onequery.dev/install.sh`.

## Slack

Lead capture notifications are delivered to the OneQuery Slack workspace
through a Worker-owned incoming webhook, not through customer self-hosted
runtimes.

Required Worker secret:

- `LANDING_SLACK_WEBHOOK_URL`

Set it with:

```bash
bunx wrangler secret put LANDING_SLACK_WEBHOOK_URL
```

## Google Analytics 4

Client-side GA4 tracking defaults to the repo-configured OneQuery measurement
ID `G-TVPWK9V4TE`.

Optional build environment variable:

- `VITE_GA_MEASUREMENT_ID`

Use it only when you need to override the default:

```bash
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX bun run landing:build
```

Tracked landing events include the initial page view, primary CTA clicks,
install command interactions, product-updates signups, and contact-form lead
submissions. Form field values are not sent to GA4.

## Local Dev

Run the SPA and Worker separately:

```bash
bun run --cwd apps/landing dev
bun run --cwd apps/landing dev:worker
```

If the SPA is running on a different origin than the Worker during local dev,
set `VITE_LANDING_API_BASE_URL` to the Worker origin.
