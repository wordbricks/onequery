import type { CommandSegment } from "./content";
import {
  animate,
  createTimeline,
  getCommandStatus,
  getTotalChars,
  getTypedChars,
} from "./timing";
import type { CommandStatus, OpenClawTimeline } from "./timing";

export type CommandModel = {
  segments: readonly CommandSegment[];
  typedChars: number;
  totalChars: number;
  status: CommandStatus;
};

export type OpenClawSceneModel = {
  frame: number;
  fps: number;
  timeline: OpenClawTimeline;
  windowScale: number;
};

export const buildCommandModel = (
  frame: number,
  start: number,
  segments: readonly CommandSegment[]
): CommandModel => {
  const totalChars = getTotalChars(segments);
  const typedChars = getTypedChars(frame, start, totalChars);

  return {
    segments,
    typedChars,
    totalChars,
    status: getCommandStatus(frame, start, typedChars, totalChars),
  };
};

export const buildOpenClawSceneModel = (
  frame: number,
  fps: number
): OpenClawSceneModel => {
  const timeline = createTimeline(fps);

  return {
    frame,
    fps,
    timeline,
    windowScale: animate(frame, timeline.window, 20, 0.985, 1),
  };
};
