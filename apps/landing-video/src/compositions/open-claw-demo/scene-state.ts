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
  };
};
