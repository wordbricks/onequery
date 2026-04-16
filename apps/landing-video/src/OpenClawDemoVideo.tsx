import { loadFont } from "@remotion/google-fonts/Geist";
import { loadFont as loadMonoFont } from "@remotion/google-fonts/JetBrainsMono";
import React from "react";
import { useCurrentFrame, interpolate, Easing, AbsoluteFill } from "remotion";

// --- Fonts (matching landing page) ---
const { fontFamily: geist } = loadFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});
const { fontFamily: mono } = loadMonoFont("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});

// Landing page easing: cubic-bezier(0.22, 1, 0.36, 1)
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const TYPING_SPEED = 2.5; // chars per frame

// --- Animation Primitives ---

const anim = (
  frame: number,
  start: number,
  dur: number,
  from: number,
  to: number
) =>
  interpolate(frame, [start, start + dur], [from, to], {
    easing: EASE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const entrance = (frame: number, start: number, dur = 14, y = 12) => ({
  opacity: anim(frame, start, dur, 0, 1),
  transform: `translateY(${anim(frame, start, dur, y, 0)}px)`,
});

// --- Typed Segments ---

type Seg = { text: string; color: string };

const renderTyped = (segs: Seg[], chars: number): React.ReactNode[] => {
  let left = chars;
  let offset = 0;
  return segs.map((s) => {
    if (left <= 0) return null;
    const n = Math.min(s.text.length, left);
    left -= s.text.length;
    const key = `${offset}:${s.color}`;
    offset += s.text.length;
    return (
      <span key={key} style={{ color: s.color }}>
        {s.text.slice(0, n)}
      </span>
    );
  });
};

const total = (segs: Seg[]) => segs.reduce((s, x) => s + x.text.length, 0);

// --- Command Definitions (syntax-colored) ---

const CMD1: Seg[] = [
  { text: "onequery", color: "#e2e8f0" },
  { text: " ", color: "#e2e8f0" },
  { text: "source show", color: "#fbbf24" },
  { text: " ", color: "#94a3b8" },
  { text: "github --output json", color: "#94a3b8" },
];

const CMD2: Seg[] = [
  { text: "onequery", color: "#e2e8f0" },
  { text: " ", color: "#e2e8f0" },
  { text: "--org wb", color: "#fbbf24" },
  { text: " ", color: "#94a3b8" },
  { text: "--request-id github-activity", color: "#94a3b8" },
  { text: " ", color: "#94a3b8" },
  { text: "api", color: "#fbbf24" },
  { text: " ", color: "#94a3b8" },
  { text: "--source github /orgs/acme-corp/events", color: "#94a3b8" },
];

const CMD3: Seg[] = [
  { text: "onequery", color: "#e2e8f0" },
  { text: " ", color: "#e2e8f0" },
  { text: "--org wb", color: "#fbbf24" },
  { text: " ", color: "#94a3b8" },
  { text: "--request-id github-activity", color: "#94a3b8" },
  { text: " ", color: "#94a3b8" },
  { text: "api", color: "#fbbf24" },
  { text: " ", color: "#94a3b8" },
  { text: "--source github /orgs/acme-corp/repos", color: "#94a3b8" },
];

// --- Timeline (frames at 30fps, 270 total = 9s) ---

const T = {
  card: 0,
  header: 5,
  userMsg: 14,
  botRow: 30,
  botText: 38,
  toolBlock: 50,
  cmd1: 66,
  cmd2: 86,
  cmd3: 125,
  analysis: 165,
  summaryLabel: 180,
  bullet0: 188,
  bulletGap: 5,
};

// --- Cursor ---

const Cursor: React.FC<{ frame: number; on: boolean }> = ({ frame, on }) => {
  if (!on) return null;
  const o = interpolate(frame % 20, [0, 10, 20], [1, 0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <span style={{ opacity: o, color: "#a78bfa", marginLeft: 1 }}>
      {"\u258C"}
    </span>
  );
};

// --- Avatars & Badge ---

const BotAvatar: React.FC = () => (
  <div
    style={{
      width: 44,
      height: 44,
      borderRadius: 22,
      background: "linear-gradient(135deg, #7c3aed, #a78bfa)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}
  >
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
        fill="white"
      />
    </svg>
  </div>
);

const UserAvatar: React.FC = () => (
  <div
    style={{
      width: 44,
      height: 44,
      borderRadius: 22,
      background: "linear-gradient(135deg, #2563eb, #60a5fa)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}
  >
    <span
      style={{
        color: "white",
        fontSize: 18,
        fontWeight: 700,
        fontFamily: geist,
      }}
    >
      U
    </span>
  </div>
);

const AgentBadge: React.FC = () => (
  <span
    style={{
      background: "#7c3aed",
      color: "white",
      fontSize: 11,
      fontWeight: 600,
      padding: "2px 6px",
      borderRadius: 4,
      marginLeft: 8,
      letterSpacing: 0.5,
      fontFamily: geist,
    }}
  >
    AGENT
  </span>
);

// --- Bullet Content ---

const BULLETS: { id: string; content: React.ReactNode }[] = [
  {
    id: "events",
    content: (
      <>
        <strong style={{ color: "#fbbf24" }}>142</strong> events across{" "}
        <strong style={{ color: "#fbbf24" }}>23</strong> repositories
      </>
    ),
  },
  {
    id: "activity-types",
    content: (
      <>
        Top: PushEvent <strong style={{ color: "#94a3b8" }}>(38)</strong>,
        PullRequest <strong style={{ color: "#94a3b8" }}>(31)</strong>,
        CreateEvent <strong style={{ color: "#94a3b8" }}>(19)</strong>
      </>
    ),
  },
  {
    id: "contributors",
    content: (
      <>
        Active contributors:{" "}
        <strong style={{ color: "#fbbf24" }}>8 members</strong>
      </>
    ),
  },
  {
    id: "focus",
    content: (
      <>
        Focus areas: <em>API redesign, CI pipeline, docs migration</em>
      </>
    ),
  },
  {
    id: "releases",
    content: (
      <>
        Recent releases: <strong style={{ color: "#34d399" }}>v2.4.0</strong>{" "}
        (Apr 14), <strong style={{ color: "#34d399" }}>v2.4.1</strong> (Apr 15)
      </>
    ),
  },
];

// --- Main Composition ---

export const OpenClawDemoVideo: React.FC = () => {
  const frame = useCurrentFrame();

  // Typing state
  const typed1 = Math.min(
    total(CMD1),
    Math.max(0, Math.floor((frame - T.cmd1) * TYPING_SPEED))
  );
  const typed2 = Math.min(
    total(CMD2),
    Math.max(0, Math.floor((frame - T.cmd2) * TYPING_SPEED))
  );
  const typed3 = Math.min(
    total(CMD3),
    Math.max(0, Math.floor((frame - T.cmd3) * TYPING_SPEED))
  );

  const done1 = typed1 >= total(CMD1);
  const done2 = typed2 >= total(CMD2);
  const done3 = typed3 >= total(CMD3);

  const cursorLine =
    !done1 && frame >= T.cmd1
      ? 1
      : !done2 && frame >= T.cmd2
        ? 2
        : !done3 && frame >= T.cmd3
          ? 3
          : 0;

  // Green status dot pulse (2.2s cycle)
  const dotScale = interpolate(frame % 66, [0, 33, 66], [1, 1.2, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dotGlow = interpolate(frame % 66, [0, 33, 66], [0, 0.4, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0a0a1a 0%, #111127 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
        fontFamily: geist,
      }}
    >
      {/* Main chat card */}
      <div
        style={{
          ...entrance(frame, T.card, 18, 18),
          width: "100%",
          maxWidth: 1100,
          background: "#12122a",
          borderRadius: 16,
          border: "1px solid rgba(124, 58, 237, 0.2)",
          boxShadow:
            "0 0 80px rgba(124, 58, 237, 0.08), 0 20px 60px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            ...entrance(frame, T.header, 11, 8),
            display: "flex",
            alignItems: "center",
            padding: "16px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(124, 58, 237, 0.05)",
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: "#34d399",
              marginRight: 10,
              transform: `scale(${dotScale})`,
              boxShadow: `0 0 ${8 + dotGlow * 12}px rgba(52, 211, 153, ${0.3 + dotGlow})`,
            }}
          />
          <span style={{ color: "#a78bfa", fontSize: 15, fontWeight: 600 }}>
            # general
          </span>
          <span style={{ color: "#64748b", fontSize: 13, marginLeft: 16 }}>
            AI agent using OneQuery to access private data
          </span>
        </div>

        {/* Messages */}
        <div
          style={{
            padding: "24px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          {/* User message */}
          <div
            style={{
              ...entrance(frame, T.userMsg, 12, 10),
              display: "flex",
              gap: 14,
            }}
          >
            <UserAvatar />
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{ color: "#60a5fa", fontWeight: 600, fontSize: 15 }}
                >
                  User
                </span>
                <span
                  style={{ color: "#475569", fontSize: 12, marginLeft: 10 }}
                >
                  Today at 3:02 PM
                </span>
              </div>
              <div style={{ color: "#e2e8f0", fontSize: 15, lineHeight: 1.5 }}>
                <span
                  style={{
                    color: "#7c3aed",
                    fontWeight: 600,
                    background: "rgba(124, 58, 237, 0.1)",
                    padding: "1px 4px",
                    borderRadius: 4,
                  }}
                >
                  @OpenClaw
                </span>{" "}
                Analyze my GitHub org's recent activity and tell me what the
                team has been focused on.
              </div>
            </div>
          </div>

          {/* Bot response */}
          <div
            style={{
              opacity: anim(frame, T.botRow, 12, 0, 1),
              display: "flex",
              gap: 14,
            }}
          >
            <BotAvatar />
            <div style={{ flex: 1 }}>
              {/* Name row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{ color: "#a78bfa", fontWeight: 600, fontSize: 15 }}
                >
                  OpenClaw
                </span>
                <AgentBadge />
                <span
                  style={{ color: "#475569", fontSize: 12, marginLeft: 10 }}
                >
                  Today at 3:02 PM
                </span>
              </div>

              {/* "Let me fetch..." */}
              <div
                style={{
                  ...entrance(frame, T.botText, 10, 6),
                  color: "#94a3b8",
                  fontSize: 14.5,
                }}
              >
                Let me fetch your org's activity data using OneQuery.
              </div>

              {/* Tool use block */}
              <div style={entrance(frame, T.toolBlock, 14, 10)}>
                <div
                  style={{
                    background: "#1a1a2e",
                    border: "1px solid rgba(124, 58, 237, 0.3)",
                    borderRadius: 8,
                    padding: "14px 18px",
                    marginTop: 10,
                    fontFamily: mono,
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}
                >
                  {/* Tool header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 10,
                      color: "#a78bfa",
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase" as const,
                      letterSpacing: 1,
                      fontFamily: geist,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6-1.6 1.6a1 1 0 1 0 1.4 1.4l2.3-2.3a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0zM9.3 6.3a1 1 0 0 1 0 1.4L7.7 9.3l1.6 1.6a1 1 0 1 1-1.4 1.4L5.6 10a1 1 0 0 1 0-1.4l2.3-2.3a1 1 0 0 1 1.4 0z"
                        fill="#a78bfa"
                      />
                    </svg>
                    Using onequery
                  </div>

                  {/* Command line 1 */}
                  <div
                    style={{
                      opacity: anim(frame, T.cmd1, 4, 0, 1),
                      color: "#94a3b8",
                    }}
                  >
                    <span style={{ color: "#22d3ee" }}>$</span>{" "}
                    {renderTyped(CMD1, typed1)}
                    <Cursor frame={frame} on={cursorLine === 1} />
                  </div>

                  {/* Command line 2 */}
                  <div
                    style={{
                      opacity: anim(frame, T.cmd2, 4, 0, 1),
                      color: "#94a3b8",
                      marginTop: 4,
                    }}
                  >
                    <span style={{ color: "#22d3ee" }}>$</span>{" "}
                    {renderTyped(CMD2, typed2)}
                    <Cursor frame={frame} on={cursorLine === 2} />
                  </div>

                  {/* Command line 3 */}
                  <div
                    style={{
                      opacity: anim(frame, T.cmd3, 4, 0, 1),
                      color: "#94a3b8",
                      marginTop: 4,
                    }}
                  >
                    <span style={{ color: "#22d3ee" }}>$</span>{" "}
                    {renderTyped(CMD3, typed3)}
                    <Cursor frame={frame} on={cursorLine === 3} />
                  </div>
                </div>
              </div>

              {/* Analysis result */}
              <div
                style={{
                  ...entrance(frame, T.analysis, 14, 12),
                  marginTop: 12,
                }}
              >
                <div
                  style={{
                    color: "#e2e8f0",
                    fontSize: 14.5,
                    lineHeight: 1.75,
                  }}
                >
                  <p style={{ marginBottom: 12 }}>
                    Here's your organization's activity summary for the last 30
                    days:
                  </p>
                  <div
                    style={{
                      background: "#1a1a2e",
                      borderRadius: 8,
                      padding: "16px 20px",
                      border: "1px solid rgba(124, 58, 237, 0.15)",
                    }}
                  >
                    <div
                      style={{
                        ...entrance(frame, T.summaryLabel, 10, 6),
                        fontWeight: 600,
                        color: "#a78bfa",
                        marginBottom: 10,
                        fontSize: 13,
                        textTransform: "uppercase" as const,
                        letterSpacing: 0.5,
                      }}
                    >
                      Summary
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {BULLETS.map((bullet, i) => (
                        <div
                          key={bullet.id}
                          style={{
                            ...entrance(
                              frame,
                              T.bullet0 + i * T.bulletGap,
                              10,
                              8
                            ),
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span style={{ color: "#22d3ee" }}>•</span>
                          <span>{bullet.content}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
