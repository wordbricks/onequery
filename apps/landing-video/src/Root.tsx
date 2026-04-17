import "./index.css";
import { Composition, Still } from "remotion";

import { OpenClawDemo } from "./OpenClawDemo";
import { OpenClawDemoVideo } from "./OpenClawDemoVideo";

export const RemotionRoot: React.FC = () => (
  <>
    <Still
      id="OpenClawDemo"
      component={OpenClawDemo}
      width={1400}
      height={900}
    />
    <Composition
      id="OpenClawDemoVideo"
      component={OpenClawDemoVideo}
      durationInFrames={600}
      fps={30}
      width={1400}
      height={900}
    />
  </>
);
