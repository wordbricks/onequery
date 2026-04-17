import { openClawDemoFps } from "./config";
import { mergedPullRequests } from "./fixtures/report";
import { normalizeOpenClawDemoProps } from "./props";
import type { OpenClawDemoProps } from "./props";
import { createOpenClawTimeline } from "./timeline";

const getOpenClawDemoScriptEndFrame = (fps: number) => {
  const timeline = createOpenClawTimeline(fps);
  const additionalPullRequestRows = Math.max(0, mergedPullRequests.length - 1);

  return timeline.mergedPullRequestPanel + additionalPullRequestRows * 2 + 12;
};

export const getOpenClawDemoDurationInFrames = (
  inputProps: OpenClawDemoProps
) =>
  getOpenClawDemoScriptEndFrame(openClawDemoFps) +
  normalizeOpenClawDemoProps(inputProps).holdAfterLastBeatFrames;

export const getOpenClawDemoStillFrame = (inputProps: OpenClawDemoProps) => {
  const normalizedProps = normalizeOpenClawDemoProps(inputProps);
  const durationInFrames = getOpenClawDemoDurationInFrames(normalizedProps);
  const stillFrameLeadFrames = Math.max(
    1,
    normalizedProps.stillFrameLeadFrames
  );

  return Math.max(
    0,
    durationInFrames - Math.min(stillFrameLeadFrames, durationInFrames)
  );
};
