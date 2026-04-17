import "./index.css";
import { Composition, Still } from "remotion";

import {
  OPEN_CLAW_HEIGHT,
  OPEN_CLAW_VIDEO_DURATION,
  OPEN_CLAW_VIDEO_FPS,
  OPEN_CLAW_WIDTH,
  OpenClawDemoScene,
  OpenClawDemoStill,
} from "./open-claw-demo/OpenClawDemoScene";

export const RemotionRoot: React.FC = () => (
  <>
    <Still
      id="OpenClawDemo"
      component={OpenClawDemoStill}
      width={OPEN_CLAW_WIDTH}
      height={OPEN_CLAW_HEIGHT}
    />
    <Composition
      id="OpenClawDemoVideo"
      component={OpenClawDemoScene}
      durationInFrames={OPEN_CLAW_VIDEO_DURATION}
      fps={OPEN_CLAW_VIDEO_FPS}
      width={OPEN_CLAW_WIDTH}
      height={OPEN_CLAW_HEIGHT}
    />
  </>
);
