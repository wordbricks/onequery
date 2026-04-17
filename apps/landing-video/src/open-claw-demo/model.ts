import { COMMANDS, EVENT_TYPES, TOP_REPOS } from "./content";
import type { CommandSegment } from "./content";
import { resolveOpenClawSceneState } from "./scene.machine";
import type { OpenClawSceneState } from "./scene.machine";
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
  scene: OpenClawSceneState;
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
  const typedChars = getTypedChars(frame, start, segments);

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
  const scene = resolveOpenClawSceneState(frame, timeline);

  return {
    frame,
    fps,
    timeline,
    scene,
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
    maxEventCount: EVENT_TYPES[0].count,
    maxRepoCount: TOP_REPOS[0].count,
  };
};
