import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { DiscordChrome } from "./DiscordChrome";
import {
  UserPromptMessage,
  YuhaReportMessage,
  YuhaRunMessage,
} from "./messages";
import { buildOpenClawSceneModel } from "./model";
import { fonts } from "./theme";

export const OPEN_CLAW_WIDTH = 1400;
export const OPEN_CLAW_HEIGHT = 900;
export const OPEN_CLAW_VIDEO_DURATION = 600;
export const OPEN_CLAW_VIDEO_FPS = 30;
export const OPEN_CLAW_STILL_FRAME = 520;
export const OPEN_CLAW_STILL_FPS = OPEN_CLAW_VIDEO_FPS;

type OpenClawDemoFrameProps = {
  frame: number;
  fps: number;
};

const OpenClawDemoFrame: React.FC<OpenClawDemoFrameProps> = ({
  frame,
  fps,
}) => {
  const model = buildOpenClawSceneModel(frame, fps);
  // Comment: In Remotion, sequence mount windows are the visibility state
  // machine; keeping them explicit avoids replaying a separate app-state
  // machine just to answer "is this on screen yet?".
  // Comment: Remotion 4.0.448 in this workspace does not expose
  // `premountFor` on `<Sequence>`, so these mounts rely on clamped frame
  // animations instead of premounting.

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
      <Sequence from={model.timeline.window} layout="none">
        <DiscordChrome model={model}>
          <Sequence
            from={model.timeline.userMessage - model.timeline.window}
            layout="none"
          >
            <UserPromptMessage model={model} />
          </Sequence>
          <Sequence
            from={model.timeline.runMessageHeader - model.timeline.window}
            layout="none"
          >
            <YuhaRunMessage model={model} />
          </Sequence>
          <Sequence
            from={model.timeline.reportMessageHeader - model.timeline.window}
            layout="none"
          >
            <YuhaReportMessage model={model} />
          </Sequence>
        </DiscordChrome>
      </Sequence>
    </AbsoluteFill>
  );
};

export const OpenClawDemoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return <OpenClawDemoFrame frame={frame} fps={fps} />;
};

export const OpenClawDemoStill: React.FC = () => (
  <OpenClawDemoFrame frame={OPEN_CLAW_STILL_FRAME} fps={OPEN_CLAW_STILL_FPS} />
);
