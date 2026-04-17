import React from "react";
import { Img, staticFile } from "remotion";

import {
  EVENT_TYPES,
  MERGED_PRS,
  NARRATIVE,
  OVERVIEW,
  TOP_REPOS,
} from "./content";
import type { OpenClawSceneModel } from "./model";
import { Bar, Pill, SectionLabel, TypedCommandLine } from "./primitives";
import { fonts, surfaces } from "./theme";
import { enter } from "./timing";

const CARD_MAX_WIDTH = 920;

export const OneQueryRunCard: React.FC<{ model: OpenClawSceneModel }> = ({
  model,
}) => {
  const {
    frame,
    scene: { hasRunCard },
    timeline,
    runCardScale,
    commands: { eventsByType, reposByActivity, mergedPulls },
  } = model;

  if (!hasRunCard) {
    return null;
  }

  const runCardEnter = enter(frame, timeline.runCard, 16, 12);

  return (
    <div
      style={{
        ...runCardEnter,
        width: "100%",
        maxWidth: CARD_MAX_WIDTH,
        display: "grid",
        gap: 8,
        padding: 10,
        borderRadius: 14,
        background: surfaces.surface,
        border: `1px solid ${surfaces.line}`,
        boxShadow:
          "0 24px 48px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.04)",
        transform: `${runCardEnter.transform} scale(${runCardScale})`,
        transformOrigin: "top left",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              overflow: "hidden",
              background: surfaces.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.08)",
            }}
          >
            <Img
              src={staticFile("onequery-icon.png")}
              style={{ width: 32, height: 32, display: "block" }}
            />
          </div>
          <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
            <strong
              style={{
                color: surfaces.ink,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
              }}
            >
              OneQuery
            </strong>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                color: surfaces.textMuted,
                fontSize: 11.5,
                lineHeight: 1.3,
              }}
            >
              <span>OpenClaw plugin</span>
              <span>·</span>
              <span>github-openclaw source</span>
              <span>·</span>
              <span>
                request-id{" "}
                <code
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 11,
                    color: surfaces.ink,
                  }}
                >
                  openclaw-weekly
                </code>
              </span>
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <Pill
            text="Read-only"
            background={surfaces.successBg}
            color={surfaces.successText}
          />
          <Pill
            text="Connected"
            background={surfaces.wash}
            color={surfaces.ink}
          />
        </div>
      </div>

      <div
        style={{
          ...enter(frame, timeline.terminal, 12, 8),
          display: "grid",
          gap: 7,
          padding: "8px 12px 10px",
          borderRadius: 10,
          background: surfaces.terminalBg,
          border: `1px solid ${surfaces.terminalBorder}`,
          fontFamily: fonts.mono,
          fontSize: 11.5,
          lineHeight: 1.32,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            paddingBottom: 3,
            borderBottom: `1px solid ${surfaces.terminalBorder}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: surfaces.terminalSoft,
                }}
              />
            ))}
          </div>
          <span
            style={{
              color: surfaces.terminalMuted,
              fontSize: 10.5,
              letterSpacing: "0.02em",
            }}
          >
            onequery · plugin run
          </span>
        </div>

        <TypedCommandLine frame={frame} command={eventsByType} />
        {eventsByType.status === "done" ? (
          <div
            style={{
              ...enter(frame, timeline.cmd1Out, 10, 4),
              paddingLeft: 18,
              color: surfaces.terminalMuted,
              fontSize: 11.5,
            }}
          >
            → 100 events · 7 types · 612 ms
          </div>
        ) : null}

        {frame >= timeline.cmd2 ? (
          <TypedCommandLine frame={frame} command={reposByActivity} />
        ) : null}
        {reposByActivity.status === "done" ? (
          <div
            style={{
              ...enter(frame, timeline.cmd2Out, 10, 4),
              paddingLeft: 18,
              color: surfaces.terminalMuted,
              fontSize: 11.5,
            }}
          >
            → 5 repos ranked · 58 ms
          </div>
        ) : null}

        {frame >= timeline.cmd3 ? (
          <TypedCommandLine frame={frame} command={mergedPulls} />
        ) : null}
        {mergedPulls.status === "done" ? (
          <div
            style={{
              ...enter(frame, timeline.cmd3Out, 10, 4),
              paddingLeft: 18,
              color: surfaces.terminalMuted,
              fontSize: 11.5,
            }}
          >
            → 11 merged PRs · 28 files changed · 812 ms
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const OneQueryReportCard: React.FC<{ model: OpenClawSceneModel }> = ({
  model,
}) => {
  const {
    frame,
    scene: { hasReportCard },
    timeline,
    reportCardScale,
    maxEventCount,
    maxRepoCount,
  } = model;

  if (!hasReportCard) {
    return null;
  }

  const reportCardEnter = enter(frame, timeline.reportCard, 16, 12);

  return (
    <div
      style={{
        ...reportCardEnter,
        width: "100%",
        maxWidth: CARD_MAX_WIDTH,
        display: "grid",
        gap: 8,
        padding: 10,
        borderRadius: 14,
        background: surfaces.surface,
        border: `1px solid ${surfaces.line}`,
        boxShadow:
          "0 20px 40px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.04)",
        transform: `${reportCardEnter.transform} scale(${reportCardScale})`,
        transformOrigin: "top left",
      }}
    >
      <div
        style={{
          ...enter(frame, timeline.reportOverview, 12, 6),
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          alignItems: "center",
          gap: 10,
          padding: "7px 9px",
          borderRadius: 10,
          background: surfaces.surfaceMuted,
          border: `1px solid ${surfaces.line}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {OVERVIEW.map((item) => (
            <div
              key={item.label}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 5,
                minWidth: 0,
                padding: "5px 7px",
                borderRadius: 8,
                background: surfaces.surface,
                border: `1px solid ${surfaces.lineSoft}`,
              }}
            >
              <strong
                style={{
                  color: surfaces.ink,
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                {item.value}
              </strong>
              <span
                style={{
                  color: surfaces.textMuted,
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                {item.label.toLowerCase()}
              </span>
            </div>
          ))}
        </div>
        <span
          style={{
            ...enter(frame, timeline.reportNarrative, 12, 4),
            minWidth: 0,
            color: surfaces.textMuted,
            fontSize: 11,
            fontWeight: 500,
            fontStyle: "italic",
            textAlign: "right",
            lineHeight: 1.45,
          }}
        >
          {NARRATIVE}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <div
          style={{
            ...enter(frame, timeline.reportTypes, 14, 8),
            display: "grid",
            gap: 5,
            padding: "8px 10px 10px",
            borderRadius: 10,
            border: `1px solid ${surfaces.line}`,
            background: surfaces.surface,
          }}
        >
          <SectionLabel text="Events by type" />
          <div style={{ display: "grid", gap: 5 }}>
            {EVENT_TYPES.map((event) => (
              <div
                key={event.type}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr) 24px",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    color: surfaces.ink,
                    fontSize: 11.5,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {event.type}
                </span>
                <Bar percent={(event.count / maxEventCount) * 100} />
                <span
                  style={{
                    color: surfaces.textMuted,
                    fontSize: 11,
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                  }}
                >
                  {event.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            ...enter(frame, timeline.reportRepos, 14, 8),
            display: "grid",
            gap: 5,
            padding: "8px 10px 10px",
            borderRadius: 10,
            border: `1px solid ${surfaces.line}`,
            background: surfaces.surface,
          }}
        >
          <SectionLabel text="Top repos" />
          <div style={{ display: "grid", gap: 5 }}>
            {TOP_REPOS.map((repo) => (
              <div
                key={repo.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr) 24px",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    color: surfaces.ink,
                    fontSize: 11.5,
                    fontWeight: 500,
                    fontFamily: fonts.mono,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {repo.name}
                </span>
                <Bar percent={(repo.count / maxRepoCount) * 100} />
                <span
                  style={{
                    color: surfaces.textMuted,
                    fontSize: 11,
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                  }}
                >
                  {repo.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          ...enter(frame, timeline.reportPRs, 14, 8),
          display: "grid",
          gap: 6,
          padding: "8px 10px 10px",
          borderRadius: 10,
          border: `1px solid ${surfaces.line}`,
          background: surfaces.surface,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <SectionLabel text="Merged PRs · openclaw/plugin" />
          <span
            style={{
              color: surfaces.textFaint,
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: "0.02em",
            }}
          >
            showing 3 of 11
          </span>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {MERGED_PRS.map((pr, index) => (
            <div
              key={pr.number}
              style={{
                ...enter(frame, timeline.reportPRs + index * 2, 12, 4),
                display: "grid",
                gridTemplateColumns: "52px minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 12,
                padding: "2px 0",
                borderTop:
                  index === 0 ? "none" : `1px solid ${surfaces.lineSoft}`,
              }}
            >
              <span
                style={{
                  color: surfaces.textSoft,
                  fontSize: 11.5,
                  fontFamily: fonts.mono,
                  fontWeight: 500,
                }}
              >
                #{pr.number}
              </span>
              <span
                style={{
                  color: surfaces.ink,
                  fontSize: 12,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {pr.title}
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: surfaces.textMuted,
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    color: surfaces.ink,
                    fontWeight: 500,
                    fontFamily: fonts.mono,
                  }}
                >
                  @{pr.user}
                </span>
                <span style={{ color: surfaces.textFaint }}>·</span>
                <span>{pr.mergedAt}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
