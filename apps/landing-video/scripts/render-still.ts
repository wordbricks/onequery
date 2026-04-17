import { spawnSync } from "node:child_process";

import {
  getOpenClawDemoStillFrame,
  OPEN_CLAW_DEMO_DEFAULT_PROPS,
} from "../src/open-claw-demo/OpenClawDemoScene";

// Keep the still export pinned to the same frame selection logic as the video.
const frame = getOpenClawDemoStillFrame(OPEN_CLAW_DEMO_DEFAULT_PROPS);

const result = spawnSync(
  "bunx",
  [
    "remotion",
    "still",
    "src/index.ts",
    "OpenClawDemoVideo",
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
