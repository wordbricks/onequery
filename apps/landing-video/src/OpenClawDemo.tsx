import React from "react";

import { OpenClawDemoScene } from "./OpenClawDemoScene";

const STILL_FRAME = 234;
const STILL_FPS = 30;

export const OpenClawDemo: React.FC = () => (
  <OpenClawDemoScene frame={STILL_FRAME} fps={STILL_FPS} />
);
