import "./index.css";
import { Composition, Still } from "remotion";

import {
  OpenClawDemoScene,
  OPEN_CLAW_STILL_FPS,
  OPEN_CLAW_STILL_FRAME,
} from "./open-claw-demo/OpenClawDemoScene";

export const RemotionRoot: React.FC = () => (
  <>
    <Still
      id="OpenClawDemo"
      component={OpenClawDemoScene}
      defaultProps={{
        frameOverride: OPEN_CLAW_STILL_FRAME,
        fpsOverride: OPEN_CLAW_STILL_FPS,
      }}
      width={1400}
      height={900}
    />
    <Composition
      id="OpenClawDemoVideo"
      component={OpenClawDemoScene}
      durationInFrames={600}
      fps={30}
      width={1400}
      height={900}
    />
  </>
);
