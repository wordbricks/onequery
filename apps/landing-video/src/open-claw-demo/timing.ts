import { Easing, interpolate } from "remotion";

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const TYPING_SPEED = 3.6;

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
  // Comment: tighten the user-to-bot reply gap slightly, but keep enough
  // breathing room that the handoff still reads as a deliberate response.
  // Comment: the previous handoff still felt too latent, so bring the whole
  // bot response chain forward by roughly three quarters of a second.
  runMessageHeader: seconds(1.98, fps),
  runMessageIntro: seconds(2.14, fps),
  runCard: seconds(2.48, fps),
  terminal: seconds(2.8, fps),
  cmd1: seconds(3.08, fps),
  // Comment: command results should land closer to the end of typing so the
  // run feels snappy without looking like the output teleported in.
  cmd1Out: seconds(5.21, fps),
  cmd2: seconds(5.56, fps),
  cmd2Out: seconds(7.71, fps),
  cmd3: seconds(8.08, fps),
  cmd3Out: seconds(10.46, fps),
  reportMessageHeader: seconds(10.74, fps),
  reportMessageIntro: seconds(10.9, fps),
  reportCard: seconds(11.24, fps),
  reportOverview: seconds(11.4, fps),
  reportNarrative: seconds(11.54, fps),
  reportTypes: seconds(11.66, fps),
  reportRepos: seconds(11.88, fps),
  reportPRs: seconds(12.18, fps),
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
