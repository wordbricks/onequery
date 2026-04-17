import { openClawDemoFps } from "./config";
import { framesFromSeconds } from "./timeline";

export type OpenClawDemoProps = {
  holdAfterLastBeatFrames: number;
  stillFrameLeadFrames: number;
};

export const defaultOpenClawDemoProps = {
  holdAfterLastBeatFrames: framesFromSeconds(7.3, openClawDemoFps),
  stillFrameLeadFrames: 80,
} satisfies OpenClawDemoProps;

const normalizeNonNegativeFrameCount = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.round(value));
};

export const normalizeOpenClawDemoProps = (
  props: OpenClawDemoProps
): OpenClawDemoProps => ({
  holdAfterLastBeatFrames: normalizeNonNegativeFrameCount(
    props.holdAfterLastBeatFrames,
    defaultOpenClawDemoProps.holdAfterLastBeatFrames
  ),
  stillFrameLeadFrames: normalizeNonNegativeFrameCount(
    props.stillFrameLeadFrames,
    defaultOpenClawDemoProps.stillFrameLeadFrames
  ),
});
