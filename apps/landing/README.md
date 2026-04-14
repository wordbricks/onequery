# Landing On Cloudflare Workers

This app is a static Vite SPA. It builds to `apps/landing/dist/client` and
deploys through **Cloudflare Workers Static Assets**, not Pages.

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
