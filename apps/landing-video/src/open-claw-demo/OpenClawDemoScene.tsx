import React from "react";
import type { CalculateMetadataFunction } from "remotion";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";

import { MERGED_PRS } from "./content";
import { DiscordChrome } from "./DiscordChrome";
import {
  UserPromptMessage,
  YuhaReportMessage,
  YuhaRunMessage,
} from "./messages";
import { buildOpenClawSceneModel } from "./model";
import { fonts } from "./theme";
import { createTimeline, seconds } from "./timing";

export const OPEN_CLAW_WIDTH = 1400;
export const OPEN_CLAW_HEIGHT = 900;
export const OPEN_CLAW_VIDEO_FPS = 30;

export type OpenClawDemoProps = {
  holdAfterLastBeatFrames: number;
  stillFrameOffsetFromEndFrames: number;
};

export const OPEN_CLAW_DEMO_DEFAULT_PROPS = {
  holdAfterLastBeatFrames: seconds(7.3, OPEN_CLAW_VIDEO_FPS),
  stillFrameOffsetFromEndFrames: 80,
} satisfies OpenClawDemoProps;

const normalizeFrameCount = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.round(value));
};

export const normalizeOpenClawDemoProps = (
  props: OpenClawDemoProps
): OpenClawDemoProps => ({
  holdAfterLastBeatFrames: normalizeFrameCount(
    props.holdAfterLastBeatFrames,
    OPEN_CLAW_DEMO_DEFAULT_PROPS.holdAfterLastBeatFrames
  ),
  stillFrameOffsetFromEndFrames: normalizeFrameCount(
    props.stillFrameOffsetFromEndFrames,
    OPEN_CLAW_DEMO_DEFAULT_PROPS.stillFrameOffsetFromEndFrames
  ),
});

const getOpenClawSceneContentEndFrame = (fps: number) => {
  const timeline = createTimeline(fps);
  const reportRowsAfterLead = Math.max(0, MERGED_PRS.length - 1);

  return timeline.reportPRs + reportRowsAfterLead * 2 + 12;
};

export const getOpenClawDemoDurationInFrames = (
  inputProps: OpenClawDemoProps
) =>
  getOpenClawSceneContentEndFrame(OPEN_CLAW_VIDEO_FPS) +
  normalizeOpenClawDemoProps(inputProps).holdAfterLastBeatFrames;

export const getOpenClawDemoStillFrame = (inputProps: OpenClawDemoProps) => {
  const props = normalizeOpenClawDemoProps(inputProps);
  const durationInFrames = getOpenClawDemoDurationInFrames(props);
  const stillFrameLeadIn = Math.max(1, props.stillFrameOffsetFromEndFrames);

  return Math.max(
    0,
    durationInFrames - Math.min(stillFrameLeadIn, durationInFrames)
  );
};

export const calculateOpenClawDemoMetadata: CalculateMetadataFunction<
  OpenClawDemoProps
> = ({ props }) => {
  const normalizedProps = normalizeOpenClawDemoProps(props);

  return {
    durationInFrames: getOpenClawDemoDurationInFrames(normalizedProps),
    props: normalizedProps,
  };
};

const OpenClawDemoContent: React.FC = () => {
  const frame = useCurrentFrame();
  const model = buildOpenClawSceneModel(frame, OPEN_CLAW_VIDEO_FPS);
  // Comment: In Remotion, sequence mount windows are the visibility state
  // machine; keeping them explicit avoids replaying a separate app-state
  // machine just to answer "is this on screen yet?".
  // Comment: Remotion 4.0.448 does expose `premountFor`; the actual constraint
  // here is `layout="none"`, so the in-flow chat rows lean on sequence-local
  // frames instead of premount containers.

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
      <Sequence
        from={model.timeline.window}
        layout="none"
        name="discord-window"
      >
        <DiscordChrome model={model}>
          <Sequence
            from={model.timeline.userMessage - model.timeline.window}
            layout="none"
            name="user-prompt"
          >
            <UserPromptMessage model={model} />
          </Sequence>
          <Sequence
            from={model.timeline.runMessageHeader - model.timeline.window}
            layout="none"
            name="yuha-run-message"
          >
            <YuhaRunMessage model={model} />
          </Sequence>
          <Sequence
            from={model.timeline.reportMessageHeader - model.timeline.window}
            layout="none"
            name="yuha-report-message"
          >
            <YuhaReportMessage model={model} />
          </Sequence>
        </DiscordChrome>
      </Sequence>
    </AbsoluteFill>
  );
};

export const OpenClawDemoScene: React.FC<OpenClawDemoProps> = () => (
  <OpenClawDemoContent />
);
