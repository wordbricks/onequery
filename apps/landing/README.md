# Landing On Cloudflare Workers

This app is a static Vite SPA that builds to `apps/landing/dist/client` and is
intended to deploy through **Cloudflare Workers Static Assets**, not Pages.

## Local Manual Deploy

The root workspace now includes `wrangler.jsonc` configured for this landing
site:

- Worker name: `onequery-landing`
- Asset directory: `apps/landing/dist/client`
- SPA fallback: `single-page-application`

Build and deploy manually:

```bash
bun run landing:deploy
```

For a preview-style upload without promoting to the latest deployed version:

```bash
bun run landing:deploy:preview
```

The first run will ask you to authenticate Wrangler with Cloudflare if you have
not already done so.

## GitHub Auto Deploy

Recommended Cloudflare Workers Builds settings for this monorepo:

- Git provider: GitHub
- Production branch: `main`
- Root directory: `.`
- Build command: `bun run landing:build`
- Deploy command: `bunx wrangler deploy`
- Non-production deploy command: `bunx wrangler versions upload`

Recommended build environment variables:

- `BUN_VERSION=1.3.10`
- `NODE_VERSION=22`

Important:

- The Cloudflare Worker project name must match `name` in
  [wrangler.jsonc](/Users/dev/git/onequery/wrangler.jsonc), currently
  `onequery-landing`.
- This repo is a Bun workspace monorepo, so the root directory should stay at
  repo root instead of `apps/landing`.
- The landing build depends on the installer asset emitted from
  `packages/self-host-runtime`, which is already handled by `bun run landing:build`.

## Domain

After the Worker is live, attach your custom domain in Cloudflare Workers:

1. Open the `onequery-landing` Worker in Cloudflare.
2. Go to `Settings` -> `Domains & Routes`.
3. Add the hostname you want to serve this landing from.

The landing page and installer currently assume the public installer URL is:

```text
https://onequery.dev/install.sh
```
