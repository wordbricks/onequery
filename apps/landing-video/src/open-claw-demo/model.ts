import { COMMANDS, MAX_EVENT_COUNT, MAX_REPO_COUNT } from "./content";
import type { CommandSegment } from "./content";
import {
  animate,
  createTimeline,
  getCommandStatus,
  getTotalChars,
  getTypedChars,
} from "./timing";
import type { CommandStatus, OpenClawTimeline } from "./timing";

type CommandKey = keyof typeof COMMANDS;

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
  runCardScale: number;
  reportCardScale: number;
  commands: Record<CommandKey, CommandModel>;
  maxEventCount: number;
  maxRepoCount: number;
};

const buildCommandModel = (
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
    runCardScale: animate(frame, timeline.runCard, 16, 0.975, 1),
    reportCardScale: animate(frame, timeline.reportCard, 16, 0.985, 1),
    commands: {
      eventsByType: buildCommandModel(
        frame,
        timeline.cmd1,
        COMMANDS.eventsByType
      ),
      reposByActivity: buildCommandModel(
        frame,
        timeline.cmd2,
        COMMANDS.reposByActivity
      ),
      mergedPulls: buildCommandModel(
        frame,
        timeline.cmd3,
        COMMANDS.mergedPulls
      ),
    },
    maxEventCount: MAX_EVENT_COUNT,
    maxRepoCount: MAX_REPO_COUNT,
  };
};
