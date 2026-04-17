import { loadFont } from "@remotion/google-fonts/Geist";
import { loadFont as loadMonoFont } from "@remotion/google-fonts/JetBrainsMono";

const { fontFamily: geist } = loadFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const { fontFamily: jetBrainsMono } = loadMonoFont("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});

export const fontFamilies = {
  sans: geist,
  mono: jetBrainsMono,
} as const;

export const discordTokens = {
  rail: "#1e1f22",
  sidebar: "#2b2d31",
  main: "#313338",
  divider: "rgba(255, 255, 255, 0.06)",
  dividerStrong: "rgba(255, 255, 255, 0.10)",
  text: "#f2f3f5",
  textMuted: "#b5bac1",
  textSoft: "#949ba4",
  textFaint: "#80848e",
  mentionBackground: "rgba(88, 101, 242, 0.30)",
  mentionText: "#dee0fc",
  blurple: "#5865f2",
  success: "#23a55a",
} as const;

export const surfaceTokens = {
  surface: "#ffffff",
  surfaceMuted: "#fafafa",
  ink: "#0a0a0a",
  textMuted: "rgba(0, 0, 0, 0.56)",
  textSoft: "rgba(0, 0, 0, 0.40)",
  textFaint: "rgba(0, 0, 0, 0.28)",
  line: "rgba(0, 0, 0, 0.10)",
  lineSoft: "rgba(0, 0, 0, 0.06)",
  wash: "rgba(0, 0, 0, 0.05)",
  barTrack: "rgba(0, 0, 0, 0.07)",
  successBackground: "rgba(22, 163, 74, 0.12)",
  successText: "#15803d",
  terminalBackground: "#0b0b0c",
  terminalBorder: "rgba(255, 255, 255, 0.10)",
  terminalPrompt: "rgba(255, 255, 255, 0.34)",
  terminalCommand: "#f4f4f5",
  terminalSubcommand: "#e4e4e7",
  terminalFlag: "#a1a1aa",
  terminalString: "#fde68a",
  terminalPath: "#bfdbfe",
  terminalJq: "#d8b4fe",
  terminalText: "#f4f4f5",
  terminalMuted: "rgba(255, 255, 255, 0.58)",
  terminalSoft: "rgba(255, 255, 255, 0.32)",
} as const;
