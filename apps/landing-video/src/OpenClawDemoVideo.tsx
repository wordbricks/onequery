import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

import { OpenClawDemoScene } from "./OpenClawDemoScene";

export const OpenClawDemoVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return <OpenClawDemoScene frame={frame} fps={fps} />;
};
