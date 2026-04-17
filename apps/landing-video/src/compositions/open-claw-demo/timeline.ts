import { Easing, interpolate } from "remotion";

const entranceEasing = Easing.bezier(0.22, 1, 0.36, 1);
const typingCharactersPerFrame = 4.8;

export type CommandTypingStatus = "idle" | "typing" | "done";

export type OpenClawTimeline = {
  windowMount: number;
  serverRailEnter: number;
  channelSidebarEnter: number;
  channelListEnter: number;
  threadHeaderEnter: number;
  userPromptMessage: number;
  runReplyHeader: number;
  runReplyIntro: number;
  runReplyCard: number;
  runTerminalPanel: number;
  eventTypeBreakdownCommand: number;
  eventTypeBreakdownResult: number;
  topRepoStarsCommand: number;
  topRepoStarsResult: number;
  mergedPullRequestSummaryCommand: number;
  mergedPullRequestSummaryResult: number;
  reportReplyHeader: number;
  reportReplyIntro: number;
  reportReplyCard: number;
  reportOverview: number;
  reportNarrative: number;
  eventTypePanel: number;
  topRepoStarsPanel: number;
  mergedPullRequestPanel: number;
};

export const framesFromSeconds = (seconds: number, fps: number) =>
  Math.round(seconds * fps);

export const createOpenClawTimeline = (fps: number): OpenClawTimeline => ({
  windowMount: 0,
  serverRailEnter: framesFromSeconds(0.18, fps),
  channelSidebarEnter: framesFromSeconds(0.36, fps),
  channelListEnter: framesFromSeconds(0.52, fps),
  threadHeaderEnter: framesFromSeconds(0.72, fps),
  userPromptMessage: framesFromSeconds(1.15, fps),
  runReplyHeader: framesFromSeconds(1.98, fps),
  runReplyIntro: framesFromSeconds(2.14, fps),
  runReplyCard: framesFromSeconds(2.48, fps),
  runTerminalPanel: framesFromSeconds(2.8, fps),
  eventTypeBreakdownCommand: framesFromSeconds(3.08, fps),
  eventTypeBreakdownResult: framesFromSeconds(5.21, fps),
  topRepoStarsCommand: framesFromSeconds(5.56, fps),
  topRepoStarsResult: framesFromSeconds(7.71, fps),
  mergedPullRequestSummaryCommand: framesFromSeconds(8.08, fps),
  mergedPullRequestSummaryResult: framesFromSeconds(10.46, fps),
  reportReplyHeader: framesFromSeconds(10.74, fps),
  reportReplyIntro: framesFromSeconds(10.9, fps),
  reportReplyCard: framesFromSeconds(11.24, fps),
  reportOverview: framesFromSeconds(11.4, fps),
  reportNarrative: framesFromSeconds(11.54, fps),
  eventTypePanel: framesFromSeconds(11.66, fps),
  topRepoStarsPanel: framesFromSeconds(11.88, fps),
  mergedPullRequestPanel: framesFromSeconds(12.18, fps),
});

export const interpolateSceneValue = (
  frame: number,
  startFrame: number,
  durationInFrames: number,
  from: number,
  to: number
) =>
  interpolate(frame, [startFrame, startFrame + durationInFrames], [from, to], {
    easing: entranceEasing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const getFadeSlideInStyle = (
  frame: number,
  startFrame: number,
  durationInFrames = 14,
  initialYOffset = 10
) => ({
  opacity: interpolateSceneValue(frame, startFrame, durationInFrames, 0, 1),
  transform: `translateY(${interpolateSceneValue(
    frame,
    startFrame,
    durationInFrames,
    initialYOffset,
    0
  )}px)`,
});

export const getCommandCharacterCount = (
  segments: readonly { text: string }[]
) => segments.reduce((sum, segment) => sum + segment.text.length, 0);

export const getVisibleCommandCharacterCount = (
  frame: number,
  startFrame: number,
  totalCharacterCount: number
) =>
  Math.min(
    totalCharacterCount,
    Math.max(0, Math.floor((frame - startFrame) * typingCharactersPerFrame))
  );

export const getCommandTypingStatus = (
  frame: number,
  startFrame: number,
  visibleCharacterCount: number,
  totalCharacterCount: number
): CommandTypingStatus => {
  if (frame < startFrame) {
    return "idle";
  }

  return visibleCharacterCount >= totalCharacterCount ? "done" : "typing";
};
