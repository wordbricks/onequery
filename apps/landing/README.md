# Landing On Cloudflare Pages

This app is a static Vite site that builds to `apps/landing/dist/client`.

## Recommended setup

Use a dedicated Cloudflare Pages project for the landing site and keep the repo
root as the Pages root directory. This repo is a Bun workspace monorepo, and
the landing build depends on the installer asset emitted from
`packages/self-host-runtime`.

Cloudflare Pages settings:

- Production branch: `main`
- Root directory: `/`
- Build command: `bun install && bun run landing:build`
- Build output directory: `apps/landing/dist/client`

## Direct upload

If you want to create or update the Pages project from the CLI instead of Git
integration:

```bash
bun run landing:deploy:cloudflare -- --project-name <pages-project-name>
```

The first run will ask you to authenticate Wrangler with Cloudflare if you have
not already done so.

## onequery.dev domain

After the Pages project is live:

1. Add `onequery.dev` in Cloudflare Pages under `Custom domains`.
2. Keep DNS for `onequery.dev` hosted in Cloudflare so the apex domain can be
   attached directly to Pages.
3. Add `www.onequery.dev` too if you want a redirect or secondary hostname.

The landing page and installer now assume the public installer URL is:

```text
https://onequery.dev/install.sh
```
