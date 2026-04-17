import "./index.css";
import { Composition, Folder } from "remotion";

import {
  calculateOpenClawDemoMetadata,
  getOpenClawDemoDurationInFrames,
  OPEN_CLAW_DEMO_DEFAULT_PROPS,
  OPEN_CLAW_HEIGHT,
  OPEN_CLAW_VIDEO_FPS,
  OPEN_CLAW_WIDTH,
  OpenClawDemoScene,
} from "./open-claw-demo/OpenClawDemoScene";

export const RemotionRoot: React.FC = () => (
  <Folder name="Landing">
    <Composition
      id="OpenClawDemoVideo"
      component={OpenClawDemoScene}
      durationInFrames={getOpenClawDemoDurationInFrames(
        OPEN_CLAW_DEMO_DEFAULT_PROPS
      )}
      fps={OPEN_CLAW_VIDEO_FPS}
      width={OPEN_CLAW_WIDTH}
      height={OPEN_CLAW_HEIGHT}
      defaultProps={OPEN_CLAW_DEMO_DEFAULT_PROPS}
      calculateMetadata={calculateOpenClawDemoMetadata}
    />
  </Folder>
);
