import type { CalculateMetadataFunction } from "remotion";

import {
  openClawDemoCompositionId,
  openClawDemoFps,
  openClawDemoHeight,
  openClawDemoWidth,
} from "./config";
import { mergedPullRequests } from "./fixtures/report";
import { defaultOpenClawDemoProps, normalizeOpenClawDemoProps } from "./props";
import type { OpenClawDemoProps } from "./props";
import { OpenClawDemoScene } from "./scene";
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

export const calculateOpenClawDemoMetadata: CalculateMetadataFunction<
  OpenClawDemoProps
> = ({ props }) => {
  const normalizedProps = normalizeOpenClawDemoProps(props);

  return {
    durationInFrames: getOpenClawDemoDurationInFrames(normalizedProps),
    props: normalizedProps,
  };
};

export const openClawDemoComposition = {
  id: openClawDemoCompositionId,
  component: OpenClawDemoScene,
  durationInFrames: getOpenClawDemoDurationInFrames(defaultOpenClawDemoProps),
  fps: openClawDemoFps,
  width: openClawDemoWidth,
  height: openClawDemoHeight,
  defaultProps: defaultOpenClawDemoProps,
  calculateMetadata: calculateOpenClawDemoMetadata,
} as const;
