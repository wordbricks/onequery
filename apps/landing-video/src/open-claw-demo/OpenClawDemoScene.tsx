import React from "react";
import { AbsoluteFill } from "remotion";

import { DiscordChrome } from "./DiscordChrome";
import {
  UserPromptMessage,
  YuhaReportMessage,
  YuhaRunMessage,
} from "./messages";
import { buildOpenClawSceneModel } from "./model";
import { fonts } from "./theme";

export const OpenClawDemoScene: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  const model = buildOpenClawSceneModel(frame, fps);

  return (
    <AbsoluteFill
      style={{
        background: "#ffffff",
        fontFamily: fonts.sans,
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 10% 6%, rgba(0, 0, 0, 0.045), transparent 32%), radial-gradient(circle at 94% 96%, rgba(0, 0, 0, 0.035), transparent 30%)",
        }}
      />

      <DiscordChrome model={model}>
        <UserPromptMessage model={model} />
        <YuhaRunMessage model={model} />
        <YuhaReportMessage model={model} />
      </DiscordChrome>
    </AbsoluteFill>
  );
};
