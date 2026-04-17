import { loadFont } from "@remotion/google-fonts/Geist";
import { loadFont as loadMonoFont } from "@remotion/google-fonts/JetBrainsMono";
import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";

const { fontFamily: geist } = loadFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const { fontFamily: mono } = loadMonoFont("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});

const TOKENS = {
  pageBg: "#ffffff",
  appBg: "#fbfbfa",
  rail: "#f2f3f5",
  sidebar: "#f7f7f8",
  surface: "#ffffff",
  surfaceMuted: "rgba(0, 0, 0, 0.025)",
  wash: "rgba(0, 0, 0, 0.05)",
  washStrong: "rgba(0, 0, 0, 0.07)",
  line: "rgba(0, 0, 0, 0.09)",
  lineStrong: "rgba(0, 0, 0, 0.14)",
  ink: "#0a0a0a",
  textMuted: "rgba(0, 0, 0, 0.66)",
  textSoft: "rgba(0, 0, 0, 0.46)",
  shadow: "0 36px 72px rgba(0, 0, 0, 0.08)",
  shadowRing: "0 0 0 1px rgba(0, 0, 0, 0.05)",
  brand: "#111111",
  discordTint: "rgba(88, 101, 242, 0.11)",
  discordTintStrong: "rgba(88, 101, 242, 0.18)",
  discordText: "#4f58d7",
  mentionBg: "rgba(37, 99, 235, 0.10)",
  mentionText: "#1d4ed8",
  successBg: "rgba(22, 163, 74, 0.10)",
  successText: "#15803d",
  terminalBg:
    "linear-gradient(180deg, rgba(18, 18, 18, 0.98), rgba(10, 10, 10, 0.98))",
  terminalEdge: "rgba(255, 255, 255, 0.08)",
  terminalText: "rgba(255, 255, 255, 0.90)",
  terminalMuted: "rgba(255, 255, 255, 0.60)",
  terminalSoft: "rgba(255, 255, 255, 0.36)",
  terminalAccent: "#d4d4d8",
  terminalPath: "#bfdbfe",
  userAccent: "#1d4ed8",
  botAccent: "#111111",
} as const;

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const TYPING_SPEED = 3.2;

type Seg = {
  text: string;
  color: string;
};

type ToolStatus = "pending" | "running" | "done";

const TOOL_STEPS = [
  {
    label: "Resolve plugin target",
    detail: "Match Discord request to the OneQuery GitHub plugin.",
  },
  {
    label: "Validate source access",
    detail: "Confirm the GitHub source is ready and scoped read-only.",
  },
  {
    label: "Fetch repo signals",
    detail: "Pull org events, merged pull requests, and release activity.",
  },
  {
    label: "Format thread reply",
    detail: "Compress findings into a short Discord-native answer.",
  },
] as const;

const SUMMARY_METRICS = [
  { label: "Mode", value: "OpenClaw plugin" },
  { label: "Policy", value: "Read-only passed" },
  { label: "Return", value: "Discord thread" },
] as const;

const SUMMARY_BODY =
  "GitHub activity is centered on making OneQuery feel native inside OpenClaw on Discord, with most visible work in plugin wiring, answer formatting, and demo polish.";

const CMD1: Seg[] = [
  { text: "onequery", color: TOKENS.terminalText },
  { text: " ", color: TOKENS.terminalText },
  { text: "source show", color: TOKENS.terminalAccent },
  { text: " ", color: TOKENS.terminalAccent },
  { text: "github-openclaw", color: TOKENS.terminalPath },
];

const CMD2: Seg[] = [
  { text: "onequery", color: TOKENS.terminalText },
  { text: " ", color: TOKENS.terminalText },
  { text: "api", color: TOKENS.terminalAccent },
  { text: " ", color: TOKENS.terminalAccent },
  { text: "--source github-openclaw", color: TOKENS.terminalMuted },
  { text: " ", color: TOKENS.terminalMuted },
  { text: "/orgs/openclaw/events", color: TOKENS.terminalPath },
];

const CMD3: Seg[] = [
  { text: "onequery", color: TOKENS.terminalText },
  { text: " ", color: TOKENS.terminalText },
  { text: "api", color: TOKENS.terminalAccent },
  { text: " ", color: TOKENS.terminalAccent },
  { text: "--source github-openclaw", color: TOKENS.terminalMuted },
  { text: " ", color: TOKENS.terminalMuted },
  {
    text: "/repos/onequery/plugin/pulls?state=closed",
    color: TOKENS.terminalPath,
  },
];

const seconds = (value: number, fps: number) => Math.round(value * fps);

const createTimeline = (fps: number) => ({
  card: 0,
  shell: seconds(0.18, fps),
  header: seconds(0.42, fps),
  prompt: seconds(0.88, fps),
  botIntro: seconds(1.28, fps),
  pluginCard: seconds(1.72, fps),
  stepBase: seconds(2.05, fps),
  terminal: seconds(2.74, fps),
  cmd1: seconds(3.05, fps),
  cmd2: seconds(3.86, fps),
  cmd3: seconds(4.86, fps),
  answerCard: seconds(6.05, fps),
  metricBase: seconds(6.38, fps),
  bulletBase: seconds(6.68, fps),
  composer: seconds(7.18, fps),
});

const animate = (
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

const enter = (frame: number, start: number, duration = 14, y = 14) => ({
  opacity: animate(frame, start, duration, 0, 1),
  transform: `translateY(${animate(frame, start, duration, y, 0)}px)`,
});

const totalChars = (segments: readonly Seg[]) =>
  segments.reduce((sum, segment) => sum + segment.text.length, 0);

const renderTyped = (segments: readonly Seg[], chars: number) => {
  let remaining = chars;
  let offset = 0;

  return segments.map((segment) => {
    if (remaining <= 0) {
      return null;
    }

    const visible = Math.min(segment.text.length, remaining);
    remaining -= segment.text.length;

    const key = `${offset}:${segment.color}`;
    offset += segment.text.length;

    return (
      <span key={key} style={{ color: segment.color }}>
        {segment.text.slice(0, visible)}
      </span>
    );
  });
};

const Cursor: React.FC<{ frame: number; visible: boolean }> = ({
  frame,
  visible,
}) => {
  if (!visible) {
    return null;
  }

  const opacity = interpolate(frame % 18, [0, 9, 18], [1, 0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <span
      style={{
        marginLeft: 2,
        color: TOKENS.terminalText,
        opacity,
      }}
    >
      {"\u258C"}
    </span>
  );
};

const Avatar: React.FC<{
  label: string;
  background: string;
  color: string;
}> = ({ label, background, color }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none",
      width: 40,
      height: 40,
      borderRadius: 20,
      background,
      color,
      fontSize: 14,
      fontWeight: 700,
      letterSpacing: "-0.04em",
      boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.58)",
    }}
  >
    {label}
  </div>
);

const StatusPill: React.FC<{
  text: string;
  background: string;
  color: string;
}> = ({ text, background, color }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      minHeight: 24,
      padding: "0 9px",
      borderRadius: 10,
      background,
      color,
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 1,
    }}
  >
    {text}
  </span>
);

const MetricCard: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div
    style={{
      display: "grid",
      gap: 5,
      padding: "11px 12px 12px",
      borderRadius: 14,
      border: `1px solid ${TOKENS.line}`,
      background: TOKENS.surface,
      boxShadow: TOKENS.shadowRing,
    }}
  >
    <span
      style={{
        color: TOKENS.textSoft,
        fontSize: 11,
        lineHeight: 1.4,
      }}
    >
      {label}
    </span>
    <strong
      style={{
        color: TOKENS.ink,
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.4,
        letterSpacing: "-0.02em",
      }}
    >
      {value}
    </strong>
  </div>
);

const ToolStepRow: React.FC<{
  frame: number;
  status: ToolStatus;
  label: string;
  detail: string;
}> = ({ frame, status, label, detail }) => {
  const runningPulse =
    status === "running"
      ? interpolate(frame % 24, [0, 12, 24], [0.65, 1, 0.65], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  const dotBackground =
    status === "done"
      ? TOKENS.successText
      : status === "running"
        ? TOKENS.discordText
        : TOKENS.washStrong;

  const dotBorder =
    status === "pending"
      ? `1px solid ${TOKENS.line}`
      : `1px solid ${status === "done" ? TOKENS.successText : TOKENS.discordText}`;

  const dotText = status === "pending" ? TOKENS.textSoft : TOKENS.surface;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "22px minmax(0, 1fr)",
        gap: 10,
        alignItems: "start",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 11,
          border: dotBorder,
          background: dotBackground,
          color: dotText,
          fontSize: 11,
          fontWeight: 700,
          opacity: runningPulse,
        }}
      >
        {status === "done" ? "✓" : status === "running" ? "•" : ""}
      </div>

      <div style={{ display: "grid", gap: 3 }}>
        <span
          style={{
            color: status === "pending" ? TOKENS.textSoft : TOKENS.ink,
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.5,
            letterSpacing: "-0.02em",
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: TOKENS.textSoft,
            fontSize: 11.5,
            lineHeight: 1.55,
          }}
        >
          {detail}
        </span>
      </div>
    </div>
  );
};

export const OpenClawDemoScene: React.FC<{ frame: number; fps: number }> = ({
  frame,
  fps,
}) => {
  const timeline = createTimeline(fps);

  const typed1 = Math.min(
    totalChars(CMD1),
    Math.max(0, Math.floor((frame - timeline.cmd1) * TYPING_SPEED))
  );
  const typed2 = Math.min(
    totalChars(CMD2),
    Math.max(0, Math.floor((frame - timeline.cmd2) * TYPING_SPEED))
  );
  const typed3 = Math.min(
    totalChars(CMD3),
    Math.max(0, Math.floor((frame - timeline.cmd3) * TYPING_SPEED))
  );

  const done1 = typed1 >= totalChars(CMD1);
  const done2 = typed2 >= totalChars(CMD2);
  const done3 = typed3 >= totalChars(CMD3);

  const activeCommand =
    !done1 && frame >= timeline.cmd1
      ? 1
      : !done2 && frame >= timeline.cmd2
        ? 2
        : !done3 && frame >= timeline.cmd3
          ? 3
          : 0;

  const stepGap = seconds(0.32, fps);
  const stepDuration = seconds(0.26, fps);

  const toolStatusFor = (index: number): ToolStatus => {
    const start = timeline.stepBase + index * stepGap;
    if (frame >= start + stepDuration) {
      return "done";
    }

    if (frame >= start) {
      return "running";
    }

    return "pending";
  };

  const cardScale = animate(frame, timeline.card, 18, 0.986, 1);
  const shellShift = animate(frame, timeline.shell, seconds(7.6, fps), 0, 1);

  return (
    <AbsoluteFill
      style={{
        background: TOKENS.pageBg,
        fontFamily: geist,
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at top left, rgba(0, 0, 0, 0.035), transparent 32%), radial-gradient(circle at 92% 12%, rgba(88, 101, 242, 0.06), transparent 24%), linear-gradient(180deg, rgba(0, 0, 0, 0.018), rgba(0, 0, 0, 0.004))",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 70,
          right: 110,
          width: 320,
          height: 320,
          borderRadius: 160,
          background:
            "radial-gradient(circle, rgba(88, 101, 242, 0.11) 0%, rgba(88, 101, 242, 0) 72%)",
          opacity: 0.28,
          filter: "blur(18px)",
        }}
      />

      <div
        style={{
          position: "absolute",
          bottom: 44,
          left: 84,
          width: 280,
          height: 280,
          borderRadius: 140,
          background:
            "radial-gradient(circle, rgba(0, 0, 0, 0.05) 0%, rgba(0, 0, 0, 0) 74%)",
          opacity: 0.28,
          filter: "blur(16px)",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            ...enter(frame, timeline.card, 18, 18),
            width: 1260,
            height: 868,
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: "86px 252px minmax(0, 1fr)",
            borderRadius: 24,
            border: `1px solid ${TOKENS.line}`,
            background: TOKENS.appBg,
            boxShadow: `${TOKENS.shadow}, ${TOKENS.shadowRing}`,
            transform: `${enter(frame, timeline.card, 18, 18).transform} scale(${cardScale})`,
          }}
        >
          <aside
            style={{
              ...enter(frame, timeline.shell, 14, 12),
              display: "grid",
              gridTemplateRows: "auto 1fr auto",
              alignItems: "start",
              padding: "18px 16px",
              background: TOKENS.rail,
              borderRight: `1px solid ${TOKENS.line}`,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 12,
                justifyItems: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 50,
                  height: 50,
                  borderRadius: 18,
                  background: TOKENS.brand,
                  color: TOKENS.surface,
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: "-0.05em",
                }}
              >
                OQ
              </div>

              {["OC", "PR", "GH", "AI"].map((item, index) => {
                const selected = index === 0;
                const offset = index * 0.04;

                return (
                  <div
                    key={item}
                    style={{
                      opacity: animate(
                        frame,
                        timeline.shell + seconds(0.1 + offset, fps),
                        10,
                        0,
                        1
                      ),
                      transform: `translateY(${animate(
                        frame,
                        timeline.shell + seconds(0.1 + offset, fps),
                        10,
                        8,
                        0
                      )}px)`,
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 50,
                      height: 50,
                      borderRadius: selected ? 18 : 25,
                      background: selected
                        ? TOKENS.discordTint
                        : TOKENS.surface,
                      color: selected ? TOKENS.discordText : TOKENS.textSoft,
                      fontSize: 13,
                      fontWeight: 700,
                      boxShadow: selected ? TOKENS.shadowRing : "none",
                    }}
                  >
                    {selected ? (
                      <span
                        style={{
                          position: "absolute",
                          left: -12,
                          width: 4,
                          height: 24 + shellShift * 10,
                          borderRadius: 999,
                          background: TOKENS.discordText,
                        }}
                      />
                    ) : null}
                    {item}
                  </div>
                );
              })}
            </div>

            <div />

            <div
              style={{
                display: "grid",
                gap: 10,
                justifyItems: "center",
              }}
            >
              {["?", "+"].map((item) => (
                <div
                  key={item}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: TOKENS.surface,
                    color: TOKENS.textSoft,
                    fontSize: 18,
                    fontWeight: 500,
                    boxShadow: TOKENS.shadowRing,
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </aside>

          <aside
            style={{
              ...enter(frame, timeline.shell + 2, 14, 12),
              display: "grid",
              gridTemplateRows: "auto auto 1fr auto",
              gap: 18,
              padding: "18px 16px 14px",
              background: TOKENS.sidebar,
              borderRight: `1px solid ${TOKENS.line}`,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 4,
                paddingBottom: 16,
                borderBottom: `1px solid ${TOKENS.line}`,
              }}
            >
              <strong
                style={{
                  color: TOKENS.ink,
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                }}
              >
                OpenClaw Labs
              </strong>
              <span
                style={{
                  color: TOKENS.textSoft,
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                Discord workspace with the OneQuery plugin attached.
              </span>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <span
                style={{
                  color: TOKENS.textSoft,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Text Channels
              </span>

              {[
                "# announcements",
                "# launch-room",
                "# plugin-demo",
                "# shipping",
                "# analytics",
              ].map((channel, index) => {
                const active = channel === "# plugin-demo";

                return (
                  <div
                    key={channel}
                    style={{
                      opacity: animate(
                        frame,
                        timeline.shell + seconds(0.12 + index * 0.05, fps),
                        10,
                        0,
                        1
                      ),
                      transform: `translateY(${animate(
                        frame,
                        timeline.shell + seconds(0.12 + index * 0.05, fps),
                        10,
                        8,
                        0
                      )}px)`,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      minHeight: 34,
                      padding: "0 10px",
                      borderRadius: 10,
                      background: active ? TOKENS.discordTint : "transparent",
                      color: active ? TOKENS.ink : TOKENS.textMuted,
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                    }}
                  >
                    <span
                      style={{
                        color: active ? TOKENS.discordText : TOKENS.textSoft,
                        fontWeight: 700,
                      }}
                    >
                      #
                    </span>
                    <span>{channel.replace("# ", "")}</span>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "grid", alignContent: "start", gap: 10 }}>
              <span
                style={{
                  color: TOKENS.textSoft,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Apps
              </span>

              <div
                style={{
                  display: "grid",
                  gap: 10,
                  padding: 12,
                  borderRadius: 16,
                  border: `1px solid ${TOKENS.line}`,
                  background: TOKENS.surface,
                  boxShadow: TOKENS.shadowRing,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar
                    label="Y"
                    background="linear-gradient(135deg, #f3f4f6, #fafaf9)"
                    color={TOKENS.botAccent}
                  />
                  <div style={{ display: "grid", gap: 2 }}>
                    <strong
                      style={{
                        color: TOKENS.ink,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      Yuha
                    </strong>
                    <span
                      style={{
                        color: TOKENS.textSoft,
                        fontSize: 11,
                        lineHeight: 1.5,
                      }}
                    >
                      OpenClaw agent
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    paddingTop: 10,
                    borderTop: `1px solid ${TOKENS.line}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        color: TOKENS.ink,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Plugin
                    </span>
                    <StatusPill
                      text="Connected"
                      background={TOKENS.successBg}
                      color={TOKENS.successText}
                    />
                  </div>
                  <span
                    style={{
                      color: TOKENS.textMuted,
                      fontSize: 11.5,
                      lineHeight: 1.55,
                    }}
                  >
                    OneQuery lets Yuha fetch GitHub context without leaving the
                    thread.
                  </span>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                paddingTop: 12,
                borderTop: `1px solid ${TOKENS.line}`,
                color: TOKENS.textSoft,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              <span>OQOQ</span>
              <span>online</span>
            </div>
          </aside>

          <main
            style={{
              display: "grid",
              gridTemplateRows: "68px minmax(0, 1fr)",
              minWidth: 0,
            }}
          >
            <div
              style={{
                ...enter(frame, timeline.header, 12, 10),
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 18,
                padding: "16px 22px",
                borderBottom: `1px solid ${TOKENS.line}`,
                background: "rgba(255, 255, 255, 0.76)",
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      color: TOKENS.textSoft,
                      fontSize: 18,
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    #
                  </span>
                  <h2
                    style={{
                      margin: 0,
                      color: TOKENS.ink,
                      fontSize: 18,
                      fontWeight: 700,
                      lineHeight: 1.1,
                      letterSpacing: "-0.03em",
                    }}
                  >
                    plugin-demo
                  </h2>
                </div>
                <span
                  style={{
                    color: TOKENS.textSoft,
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  OpenClaw agent uses the OneQuery plugin to answer inside this
                  Discord channel.
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusPill
                  text="OpenClaw agent"
                  background={TOKENS.wash}
                  color={TOKENS.ink}
                />
                <StatusPill
                  text="OneQuery plugin"
                  background={TOKENS.discordTint}
                  color={TOKENS.discordText}
                />
              </div>
            </div>

            <div
              style={{
                minHeight: 0,
              }}
            >
              <div
                style={{
                  minHeight: 0,
                  padding: "18px 22px 18px",
                  display: "grid",
                  gap: 14,
                  alignContent: "start",
                }}
              >
                <div
                  style={{
                    ...enter(frame, timeline.prompt, 12, 10),
                    display: "flex",
                    gap: 14,
                  }}
                >
                  <Avatar
                    label="OQ"
                    background="linear-gradient(135deg, #dbeafe, #eff6ff)"
                    color={TOKENS.userAccent}
                  />

                  <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          color: TOKENS.ink,
                          fontSize: 15,
                          fontWeight: 600,
                        }}
                      >
                        OQOQ
                      </span>
                      <span
                        style={{
                          color: TOKENS.textSoft,
                          fontSize: 12,
                          lineHeight: 1.4,
                        }}
                      >
                        2:46 PM
                      </span>
                    </div>

                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        width: "fit-content",
                        maxWidth: 690,
                        padding: "11px 13px",
                        borderRadius: 16,
                        background: TOKENS.surface,
                        border: `1px solid ${TOKENS.line}`,
                        color: TOKENS.ink,
                        fontSize: 14,
                        lineHeight: 1.55,
                        boxShadow: TOKENS.shadowRing,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          minHeight: 24,
                          padding: "0 8px",
                          borderRadius: 8,
                          background: TOKENS.mentionBg,
                          color: TOKENS.mentionText,
                          fontSize: 13,
                          fontWeight: 600,
                          lineHeight: 1,
                        }}
                      >
                        @Yuha
                      </span>
                      <span>
                        Use the OneQuery plugin and tell me what changed across
                        GitHub this week for the OpenClaw workflow.
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    opacity: animate(frame, timeline.botIntro, 12, 0, 1),
                    display: "flex",
                    gap: 14,
                  }}
                >
                  <Avatar
                    label="Y"
                    background="linear-gradient(135deg, #f3f4f6, #fafaf9)"
                    color={TOKENS.botAccent}
                  />

                  <div
                    style={{ display: "grid", gap: 12, minWidth: 0, flex: 1 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          color: TOKENS.ink,
                          fontSize: 15,
                          fontWeight: 600,
                        }}
                      >
                        Yuha
                      </span>
                      <StatusPill
                        text="App"
                        background={TOKENS.wash}
                        color={TOKENS.textSoft}
                      />
                      <span
                        style={{
                          color: TOKENS.textSoft,
                          fontSize: 12,
                          lineHeight: 1.4,
                        }}
                      >
                        2:46 PM
                      </span>
                    </div>

                    <p
                      style={{
                        ...enter(frame, timeline.botIntro + 4, 10, 8),
                        margin: 0,
                        maxWidth: 760,
                        color: TOKENS.textMuted,
                        fontSize: 13.5,
                        lineHeight: 1.6,
                      }}
                    >
                      Running the OneQuery GitHub plugin now. I will validate
                      source access, inspect repo activity, and summarize the
                      workflow back in this thread.
                    </p>

                    <div
                      style={{
                        ...enter(frame, timeline.pluginCard, 14, 12),
                        width: 780,
                        maxWidth: "100%",
                        display: "grid",
                        gap: 12,
                        padding: 12,
                        borderRadius: 18,
                        border: `1px solid ${TOKENS.lineStrong}`,
                        background:
                          "linear-gradient(180deg, #ffffff 0%, rgba(0, 0, 0, 0.012) 100%)",
                        boxShadow:
                          "0 14px 30px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.46)",
                      }}
                    >
                      {/* Keep enough Discord chrome visible while borrowing the landing palette. */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 14,
                        }}
                      >
                        <div style={{ display: "grid", gap: 5 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                width: 11,
                                height: 11,
                                borderRadius: 4,
                                background: TOKENS.discordText,
                              }}
                            />
                            <strong
                              style={{
                                color: TOKENS.ink,
                                fontSize: 14,
                                fontWeight: 700,
                                letterSpacing: "-0.02em",
                              }}
                            >
                              OneQuery plugin run
                            </strong>
                          </div>
                          <span
                            style={{
                              color: TOKENS.textMuted,
                              fontSize: 12,
                              lineHeight: 1.55,
                            }}
                          >
                            OpenClaw calls OneQuery as a Discord tool, then
                            posts the result back inline.
                          </span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                            justifyContent: "flex-end",
                          }}
                        >
                          <StatusPill
                            text="Discord tool"
                            background={TOKENS.discordTint}
                            color={TOKENS.discordText}
                          />
                          <StatusPill
                            text="Read-only"
                            background={TOKENS.successBg}
                            color={TOKENS.successText}
                          />
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "260px minmax(0, 1fr)",
                          gap: 14,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gap: 12,
                            padding: 12,
                            borderRadius: 14,
                            background: TOKENS.surfaceMuted,
                            border: `1px solid ${TOKENS.line}`,
                          }}
                        >
                          {TOOL_STEPS.map((step, index) => (
                            <div
                              key={step.label}
                              style={enter(
                                frame,
                                timeline.stepBase + index * 2,
                                10,
                                6
                              )}
                            >
                              <ToolStepRow
                                frame={frame}
                                status={toolStatusFor(index)}
                                label={step.label}
                                detail={step.detail}
                              />
                            </div>
                          ))}
                        </div>

                        <div
                          style={{
                            ...enter(frame, timeline.terminal, 12, 10),
                            display: "grid",
                            gap: 12,
                            padding: 12,
                            borderRadius: 14,
                            border: `1px solid ${TOKENS.terminalEdge}`,
                            background: TOKENS.terminalBg,
                            boxShadow:
                              "0 20px 40px rgba(0, 0, 0, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12,
                            }}
                          >
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <div
                                style={{
                                  display: "inline-flex",
                                  gap: 8,
                                }}
                              >
                                {[0, 1, 2].map((dot) => (
                                  <span
                                    key={dot}
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: 999,
                                      background: TOKENS.terminalSoft,
                                    }}
                                  />
                                ))}
                              </div>
                              <span
                                style={{
                                  color: TOKENS.terminalMuted,
                                  fontSize: 11,
                                  lineHeight: 1.5,
                                }}
                              >
                                plugin execution
                              </span>
                            </div>

                            <span
                              style={{
                                color: TOKENS.terminalMuted,
                                fontSize: 11,
                                lineHeight: 1.5,
                              }}
                            >
                              GitHub source
                            </span>
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gap: 10,
                              alignContent: "start",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                gap: 10,
                                minHeight: 20,
                                color: TOKENS.terminalText,
                                fontSize: 13,
                                lineHeight: 1.65,
                                fontFamily: mono,
                              }}
                            >
                              <span style={{ color: TOKENS.terminalSoft }}>
                                $
                              </span>
                              <code
                                style={{ margin: 0, whiteSpace: "pre-wrap" }}
                              >
                                {renderTyped(CMD1, typed1)}
                                <Cursor
                                  frame={frame}
                                  visible={activeCommand === 1}
                                />
                              </code>
                            </div>

                            {done1 ? (
                              <div
                                style={{
                                  ...enter(frame, timeline.cmd1 + 18, 10, 6),
                                  paddingLeft: 20,
                                  color: TOKENS.terminalMuted,
                                  fontSize: 12,
                                  lineHeight: 1.6,
                                  fontFamily: mono,
                                }}
                              >
                                source github-openclaw ready
                              </div>
                            ) : null}

                            {frame >= timeline.cmd2 ? (
                              <div
                                style={{
                                  display: "flex",
                                  gap: 10,
                                  minHeight: 20,
                                  color: TOKENS.terminalText,
                                  fontSize: 13,
                                  lineHeight: 1.65,
                                  fontFamily: mono,
                                }}
                              >
                                <span style={{ color: TOKENS.terminalSoft }}>
                                  $
                                </span>
                                <code
                                  style={{ margin: 0, whiteSpace: "pre-wrap" }}
                                >
                                  {renderTyped(CMD2, typed2)}
                                  <Cursor
                                    frame={frame}
                                    visible={activeCommand === 2}
                                  />
                                </code>
                              </div>
                            ) : null}

                            {done2 ? (
                              <div
                                style={{
                                  ...enter(frame, timeline.cmd2 + 24, 10, 6),
                                  paddingLeft: 20,
                                  color: TOKENS.terminalMuted,
                                  fontSize: 12,
                                  lineHeight: 1.6,
                                  fontFamily: mono,
                                }}
                              >
                                42 org events returned in 612 ms
                              </div>
                            ) : null}

                            {frame >= timeline.cmd3 ? (
                              <div
                                style={{
                                  display: "flex",
                                  gap: 10,
                                  minHeight: 20,
                                  color: TOKENS.terminalText,
                                  fontSize: 13,
                                  lineHeight: 1.65,
                                  fontFamily: mono,
                                }}
                              >
                                <span style={{ color: TOKENS.terminalSoft }}>
                                  $
                                </span>
                                <code
                                  style={{ margin: 0, whiteSpace: "pre-wrap" }}
                                >
                                  {renderTyped(CMD3, typed3)}
                                  <Cursor
                                    frame={frame}
                                    visible={activeCommand === 3}
                                  />
                                </code>
                              </div>
                            ) : null}

                            {done3 ? (
                              <div
                                style={{
                                  ...enter(frame, timeline.cmd3 + 28, 10, 6),
                                  display: "grid",
                                  gap: 4,
                                  paddingLeft: 20,
                                  color: TOKENS.terminalMuted,
                                  fontSize: 12,
                                  lineHeight: 1.6,
                                  fontFamily: mono,
                                }}
                              >
                                <span>11 merged pull requests returned</span>
                                <span>reply prepared for Discord thread</span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        ...enter(frame, timeline.answerCard, 14, 12),
                        width: 780,
                        maxWidth: "100%",
                        display: "grid",
                        gap: 12,
                        padding: 12,
                        borderRadius: 18,
                        background: TOKENS.surface,
                        border: `1px solid ${TOKENS.line}`,
                        boxShadow: TOKENS.shadowRing,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <strong
                          style={{
                            color: TOKENS.ink,
                            fontSize: 14,
                            fontWeight: 700,
                            letterSpacing: "-0.02em",
                          }}
                        >
                          Thread reply
                        </strong>
                        <StatusPill
                          text="posted by Yuha"
                          background={TOKENS.wash}
                          color={TOKENS.textSoft}
                        />
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                          gap: 10,
                        }}
                      >
                        {SUMMARY_METRICS.map((metric, index) => (
                          <div
                            key={metric.label}
                            style={enter(
                              frame,
                              timeline.metricBase + index * 3,
                              10,
                              8
                            )}
                          >
                            <MetricCard
                              label={metric.label}
                              value={metric.value}
                            />
                          </div>
                        ))}
                      </div>

                      <div
                        style={{
                          ...enter(frame, timeline.bulletBase, 12, 8),
                          display: "grid",
                          gap: 8,
                          padding: "2px 2px 0",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              background: TOKENS.discordText,
                            }}
                          />
                          <span
                            style={{
                              color: TOKENS.ink,
                              fontSize: 12,
                              fontWeight: 600,
                              lineHeight: 1.5,
                            }}
                          >
                            Short answer for Discord
                          </span>
                        </div>
                        <p
                          style={{
                            margin: 0,
                            color: TOKENS.textMuted,
                            fontSize: 13,
                            lineHeight: 1.6,
                          }}
                        >
                          {SUMMARY_BODY}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </AbsoluteFill>
  );
};
