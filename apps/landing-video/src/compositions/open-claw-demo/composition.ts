import type { CalculateMetadataFunction } from "remotion";

import {
  openClawDemoCompositionId,
  openClawDemoFps,
  openClawDemoHeight,
  openClawDemoWidth,
} from "./config";
import {
  getOpenClawDemoDurationInFrames,
  getOpenClawDemoStillFrame,
} from "./duration";
import { defaultOpenClawDemoProps, normalizeOpenClawDemoProps } from "./props";
import type { OpenClawDemoProps } from "./props";
import { OpenClawDemoScene } from "./scene";

export { getOpenClawDemoStillFrame };

const calculateOpenClawDemoMetadata: CalculateMetadataFunction<
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
