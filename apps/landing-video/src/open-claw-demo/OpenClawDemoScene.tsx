import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

import { DiscordChrome } from "./DiscordChrome";
import {
  UserPromptMessage,
  YuhaReportMessage,
  YuhaRunMessage,
} from "./messages";
import { buildOpenClawSceneModel } from "./model";
import { fonts } from "./theme";

export const OPEN_CLAW_STILL_FRAME = 520;
export const OPEN_CLAW_STILL_FPS = 30;

export type OpenClawDemoSceneProps = {
  frameOverride?: number;
  fpsOverride?: number;
};

export const OpenClawDemoScene: React.FC<OpenClawDemoSceneProps> = ({
  frameOverride,
  fpsOverride,
}) => {
  const currentFrame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const frame = frameOverride ?? currentFrame;
  const resolvedFps = fpsOverride ?? fps;
  const model = buildOpenClawSceneModel(frame, resolvedFps);

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
