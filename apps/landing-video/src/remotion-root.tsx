import "./index.css";
import { Composition, Folder } from "remotion";

import { openClawDemoComposition } from "./compositions/open-claw-demo";

export const RemotionRoot: React.FC = () => (
  <Folder name="Landing">
    <Composition {...openClawDemoComposition} />
  </Folder>
);
