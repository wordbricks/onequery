# Landing Video

Remotion workspace for generating landing page video assets.

Work from this directory:

```bash
cd apps/landing-video
```

## Commands

```bash
bun run dev
bun run build
bun run render
bun run render:still
bun run typecheck
```

## Outputs

`build` creates the Remotion bundle in `build/`.

`render` writes the main landing video to `out/openclaw-demo-video.mp4`.

`render:still` writes the landing still frame to `out/openclaw-demo.png`.

## Notes

Dependencies are installed through the workspace, but day-to-day work for this
package should assume `apps/landing-video` as the current directory.
