import React from "react";

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
    <span style={{ color: "white", fontSize: 18, fontWeight: 700 }}>U</span>
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
    }}
  >
    AGENT
  </span>
);

const ToolUseBlock: React.FC = () => (
  <div
    style={{
      background: "#1a1a2e",
      border: "1px solid rgba(124, 58, 237, 0.3)",
      borderRadius: 8,
      padding: "14px 18px",
      marginTop: 10,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.7,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 10,
        color: "#a78bfa",
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 1,
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
    <div style={{ color: "#94a3b8" }}>
      <span style={{ color: "#22d3ee" }}>$</span>{" "}
      <span style={{ color: "#e2e8f0" }}>onequery</span>{" "}
      <span style={{ color: "#fbbf24" }}>source show</span>{" "}
      <span style={{ color: "#94a3b8" }}>github --output json</span>
    </div>
    <div style={{ color: "#94a3b8", marginTop: 4 }}>
      <span style={{ color: "#22d3ee" }}>$</span>{" "}
      <span style={{ color: "#e2e8f0" }}>onequery</span>{" "}
      <span style={{ color: "#fbbf24" }}>--org wb</span>{" "}
      <span style={{ color: "#94a3b8" }}>--request-id github-activity</span>{" "}
      <span style={{ color: "#fbbf24" }}>api</span>{" "}
      <span style={{ color: "#94a3b8" }}>
        --source github /orgs/acme-corp/events
      </span>
    </div>
    <div style={{ color: "#94a3b8", marginTop: 4 }}>
      <span style={{ color: "#22d3ee" }}>$</span>{" "}
      <span style={{ color: "#e2e8f0" }}>onequery</span>{" "}
      <span style={{ color: "#fbbf24" }}>--org wb</span>{" "}
      <span style={{ color: "#94a3b8" }}>--request-id github-activity</span>{" "}
      <span style={{ color: "#fbbf24" }}>api</span>{" "}
      <span style={{ color: "#94a3b8" }}>
        --source github /orgs/acme-corp/repos
      </span>
    </div>
  </div>
);

const AnalysisResult: React.FC = () => (
  <div
    style={{
      marginTop: 12,
      color: "#e2e8f0",
      fontSize: 14.5,
      lineHeight: 1.75,
    }}
  >
    <p style={{ marginBottom: 12 }}>
      Here's your organization's activity summary for the last 30 days:
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
          fontWeight: 600,
          color: "#a78bfa",
          marginBottom: 10,
          fontSize: 13,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        Summary
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#22d3ee" }}>•</span>
          <span>
            <strong style={{ color: "#fbbf24" }}>142</strong> events across{" "}
            <strong style={{ color: "#fbbf24" }}>23</strong> repositories
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#22d3ee" }}>•</span>
          <span>
            Top: PushEvent <strong style={{ color: "#94a3b8" }}>(38)</strong>,
            PullRequest <strong style={{ color: "#94a3b8" }}>(31)</strong>,
            CreateEvent <strong style={{ color: "#94a3b8" }}>(19)</strong>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#22d3ee" }}>•</span>
          <span>
            Active contributors:{" "}
            <strong style={{ color: "#fbbf24" }}>8 members</strong>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#22d3ee" }}>•</span>
          <span>
            Focus areas: <em>API redesign, CI pipeline, docs migration</em>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#22d3ee" }}>•</span>
          <span>
            Recent releases:{" "}
            <strong style={{ color: "#34d399" }}>v2.4.0</strong> (Apr 14),{" "}
            <strong style={{ color: "#34d399" }}>v2.4.1</strong> (Apr 15)
          </span>
        </div>
      </div>
    </div>
  </div>
);

export const OpenClawDemo: React.FC = () => (
  <div
    style={{
      width: "100%",
      height: "100%",
      background: "linear-gradient(180deg, #0a0a1a 0%, #111127 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 48,
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}
  >
    {/* Main chat card */}
    <div
      style={{
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
          }}
        />
        <span
          style={{
            color: "#a78bfa",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          # general
        </span>
        <span
          style={{
            color: "#64748b",
            fontSize: 13,
            marginLeft: 16,
          }}
        >
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
        <div style={{ display: "flex", gap: 14 }}>
          <UserAvatar />
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <span style={{ color: "#60a5fa", fontWeight: 600, fontSize: 15 }}>
                User
              </span>
              <span style={{ color: "#475569", fontSize: 12, marginLeft: 10 }}>
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
              Analyze my GitHub org's recent activity and tell me what the team
              has been focused on.
            </div>
          </div>
        </div>

        {/* Agent response */}
        <div style={{ display: "flex", gap: 14 }}>
          <BotAvatar />
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <span style={{ color: "#a78bfa", fontWeight: 600, fontSize: 15 }}>
                OpenClaw
              </span>
              <AgentBadge />
              <span style={{ color: "#475569", fontSize: 12, marginLeft: 10 }}>
                Today at 3:02 PM
              </span>
            </div>
            <div style={{ color: "#94a3b8", fontSize: 14.5 }}>
              Let me fetch your org's activity data using OneQuery.
            </div>
            <ToolUseBlock />
            <AnalysisResult />
          </div>
        </div>
      </div>
    </div>
  </div>
);
