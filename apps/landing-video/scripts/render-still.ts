import { spawnSync } from "node:child_process";

import {
  getOpenClawDemoStillFrame,
  openClawDemoComposition,
} from "../src/compositions/open-claw-demo";

// Keep the still export pinned to the same frame selection logic as the video.
const frame = getOpenClawDemoStillFrame(openClawDemoComposition.defaultProps);

const result = spawnSync(
  "bunx",
  [
    "remotion",
    "still",
    "src/index.ts",
    openClawDemoComposition.id,
    "out/openclaw-demo.png",
    "--frame",
    String(frame),
  ],
  {
    stdio: "inherit",
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
