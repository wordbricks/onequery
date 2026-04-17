import type { CommandSegment } from "./fixtures/terminal";
import {
  createOpenClawTimeline,
  getCommandCharacterCount,
  getCommandTypingStatus,
  getVisibleCommandCharacterCount,
  interpolateSceneValue,
} from "./timeline";
import type { CommandTypingStatus, OpenClawTimeline } from "./timeline";

export type CommandRenderState = {
  segments: readonly CommandSegment[];
  visibleCharacterCount: number;
  totalCharacterCount: number;
  typingStatus: CommandTypingStatus;
};

export type OpenClawDemoSceneState = {
  frame: number;
  fps: number;
  timeline: OpenClawTimeline;
  discordWindowScale: number;
  discordThreadScrollY: number;
};

export const buildCommandRenderState = (
  frame: number,
  startFrame: number,
  segments: readonly CommandSegment[]
): CommandRenderState => {
  const totalCharacterCount = getCommandCharacterCount(segments);
  const visibleCharacterCount = getVisibleCommandCharacterCount(
    frame,
    startFrame,
    totalCharacterCount
  );

  return {
    segments,
    visibleCharacterCount,
    totalCharacterCount,
    typingStatus: getCommandTypingStatus(
      frame,
      startFrame,
      visibleCharacterCount,
      totalCharacterCount
    ),
  };
};

export const buildOpenClawDemoSceneState = (
  frame: number,
  fps: number
): OpenClawDemoSceneState => {
  const timeline = createOpenClawTimeline(fps);
  const reportReplyScrollY = interpolateSceneValue(
    frame,
    timeline.reportReplyHeader,
    18,
    0,
    22
  );
  const reportCardRevealScrollY = interpolateSceneValue(
    frame,
    timeline.reportReplyCard,
    36,
    0,
    82
  );
  const mergedPullRequestRevealScrollY = interpolateSceneValue(
    frame,
    timeline.mergedPullRequestPanel,
    12,
    0,
    46
  );

  return {
    frame,
    fps,
    timeline,
    discordWindowScale: interpolateSceneValue(
      frame,
      timeline.windowMount,
      20,
      0.985,
      1
    ),
    // Scroll older messages upward as the second assistant reply expands,
    // keeping the newest Discord content inside the viewport. Bias an extra
    // lift into the merged-PR reveal so the last report rows do not clip
    // against the composer while they animate in.
    discordThreadScrollY:
      reportReplyScrollY +
      reportCardRevealScrollY +
      mergedPullRequestRevealScrollY,
  };
};
