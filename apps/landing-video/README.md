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
bun run render:webm
bun run render:still
bun run typecheck
```

## Outputs

`build` creates the Remotion bundle in `build/`.

`render` writes the main landing video to `out/openclaw-demo-video.mp4`.

`render:webm` writes the VP8 WebM landing video to
`out/openclaw-demo-video.webm`.

`render:still` writes the landing still frame to `out/openclaw-demo.png`.

## Notes

Dependencies are installed through the workspace, but day-to-day work for this
package should assume `apps/landing-video` as the current directory.

## Structure

The app is organized composition-first under `src/compositions/`.

For the OpenClaw landing asset:

- `composition.ts` owns composition metadata, duration, and still-frame helpers.
- `scene.tsx` owns the top-level visual tree only.
- `timeline.ts` and `scene-state.ts` own timing math and render-state derivation.
- `fixtures/` holds static demo content and report data.
- `components/` holds Discord chrome, chat thread rows, and summary cards.

`src/remotion-root.tsx` is intentionally thin and only registers compositions.
