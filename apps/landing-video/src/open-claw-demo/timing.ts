import { Easing, interpolate } from "remotion";

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const TYPING_SPEED = 2.4;

export type CommandStatus = "idle" | "typing" | "done";

export type OpenClawTimeline = {
  window: number;
  rail: number;
  sidebar: number;
  channels: number;
  header: number;
  userMessage: number;
  runMessageHeader: number;
  runMessageIntro: number;
  runCard: number;
  terminal: number;
  cmd1: number;
  cmd1Out: number;
  cmd2: number;
  cmd2Out: number;
  cmd3: number;
  cmd3Out: number;
  reportMessageHeader: number;
  reportMessageIntro: number;
  reportCard: number;
  reportOverview: number;
  reportNarrative: number;
  reportTypes: number;
  reportRepos: number;
  reportPRs: number;
};

export const seconds = (value: number, fps: number) => Math.round(value * fps);

export const createTimeline = (fps: number): OpenClawTimeline => ({
  window: 0,
  rail: seconds(0.18, fps),
  sidebar: seconds(0.36, fps),
  channels: seconds(0.52, fps),
  header: seconds(0.72, fps),
  userMessage: seconds(1.15, fps),
  runMessageHeader: seconds(2.95, fps),
  runMessageIntro: seconds(3.15, fps),
  runCard: seconds(3.55, fps),
  terminal: seconds(3.95, fps),
  cmd1: seconds(4.3, fps),
  cmd1Out: seconds(6.65, fps),
  cmd2: seconds(7.15, fps),
  cmd2Out: seconds(9.65, fps),
  cmd3: seconds(10.15, fps),
  cmd3Out: seconds(12.95, fps),
  reportMessageHeader: seconds(13.35, fps),
  reportMessageIntro: seconds(13.55, fps),
  reportCard: seconds(13.95, fps),
  reportOverview: seconds(14.15, fps),
  reportNarrative: seconds(14.32, fps),
  reportTypes: seconds(14.45, fps),
  reportRepos: seconds(14.68, fps),
  reportPRs: seconds(15.02, fps),
});

export const animate = (
  frame: number,
  start: number,
  duration: number,
  from: number,
  to: number
) =>
  interpolate(frame, [start, start + duration], [from, to], {
    easing: EASE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const enter = (frame: number, start: number, duration = 14, y = 10) => ({
  opacity: animate(frame, start, duration, 0, 1),
  transform: `translateY(${animate(frame, start, duration, y, 0)}px)`,
});

export const getTotalChars = (segments: readonly { text: string }[]) =>
  segments.reduce((sum, segment) => sum + segment.text.length, 0);

export const getTypedChars = (
  frame: number,
  start: number,
  totalChars: number
) =>
  Math.min(totalChars, Math.max(0, Math.floor((frame - start) * TYPING_SPEED)));

export const getCommandStatus = (
  frame: number,
  start: number,
  typedChars: number,
  totalChars: number
): CommandStatus => {
  if (frame < start) {
    return "idle";
  }
  return typedChars >= totalChars ? "done" : "typing";
};
