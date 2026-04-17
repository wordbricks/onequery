import React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";

import {
  COMMANDS,
  EVENT_TYPES,
  MAX_EVENT_COUNT,
  MAX_REPO_COUNT,
  MERGED_PRS,
  NARRATIVE,
  OVERVIEW,
  TOP_REPOS,
} from "./content";
import { buildCommandModel } from "./model";
import type { CommandModel, OpenClawSceneModel } from "./model";
import { Bar, Pill, SectionLabel, TypedCommandLine } from "./primitives";
import { fonts, surfaces } from "./theme";
import { animate, enter } from "./timing";

const CARD_MAX_WIDTH = 920;
const ONEQUERY_ICON_SRC = staticFile("onequery-icon.png");
const CARD_SHELL_STYLE: React.CSSProperties = {
  width: "100%",
  maxWidth: CARD_MAX_WIDTH,
  display: "grid",
  gap: 8,
  padding: 10,
  borderRadius: 14,
  background: surfaces.surface,
  border: `1px solid ${surfaces.line}`,
  transformOrigin: "top left",
};
const REPORT_PANEL_STYLE: React.CSSProperties = {
  display: "grid",
  gap: 5,
  padding: "8px 10px 10px",
  borderRadius: 10,
  border: `1px solid ${surfaces.line}`,
  background: surfaces.surface,
};
const METRIC_ROW_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr) 24px",
  alignItems: "center",
  gap: 10,
};

type ScaledCardShellProps = {
  enterStyle: React.CSSProperties;
  scale: number;
  shadow: string;
  children: React.ReactNode;
};

type RunStep = {
  key: string;
  command: CommandModel;
  resultStart: number;
  result: string;
};

type MetricSectionProps = {
  enterStyle: React.CSSProperties;
  maxCount: number;
  rows: readonly {
    count: number;
    label: string;
    key: string | number;
  }[];
  monoLabels?: boolean;
  title: string;
};

const ScaledCardShell: React.FC<ScaledCardShellProps> = ({
  enterStyle,
  scale,
  shadow,
  children,
}) => (
  <div
    style={{
      ...CARD_SHELL_STYLE,
      ...enterStyle,
      boxShadow: shadow,
      transform: `${enterStyle.transform} scale(${scale})`,
    }}
  >
    {children}
  </div>
);

const TerminalResultLine: React.FC<{
  frame: number;
  start: number;
  text: string;
}> = ({ frame, start, text }) => (
  <div
    style={{
      ...enter(frame, start, 10, 4),
      paddingLeft: 18,
      color: surfaces.terminalMuted,
      fontSize: 11.5,
    }}
  >
    {text}
  </div>
);

const MetricSection: React.FC<MetricSectionProps> = ({
  enterStyle,
  maxCount,
  rows,
  monoLabels = false,
  title,
}) => (
  <div
    style={{
      ...REPORT_PANEL_STYLE,
      ...enterStyle,
    }}
  >
    <SectionLabel text={title} />
    <div style={{ display: "grid", gap: 5 }}>
      {rows.map((row) => (
        <div key={row.key} style={METRIC_ROW_STYLE}>
          <span
            style={{
              color: surfaces.ink,
              fontSize: 11.5,
              fontWeight: 500,
              fontFamily: monoLabels ? fonts.mono : undefined,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.label}
          </span>
          <Bar percent={(row.count / maxCount) * 100} />
          <span
            style={{
              color: surfaces.textMuted,
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
              textAlign: "right",
            }}
          >
            {row.count}
          </span>
        </div>
      ))}
    </div>
  </div>
);

export const OneQueryRunCard: React.FC<{ model: OpenClawSceneModel }> = ({
  model,
}) => {
  const frame = useCurrentFrame();
  const { timeline } = model;
  const runCardEnter = enter(frame, 0, 16, 12);
  const runCardScale = animate(frame, 0, 16, 0.975, 1);
  const eventsByType = buildCommandModel(
    frame,
    timeline.cmd1 - timeline.runCard,
    COMMANDS.eventsByType
  );
  const reposByActivity = buildCommandModel(
    frame,
    timeline.cmd2 - timeline.runCard,
    COMMANDS.reposByActivity
  );
  const mergedPulls = buildCommandModel(
    frame,
    timeline.cmd3 - timeline.runCard,
    COMMANDS.mergedPulls
  );
  const runSteps: readonly RunStep[] = [
    {
      key: "eventsByType",
      command: eventsByType,
      resultStart: timeline.cmd1Out - timeline.runCard,
      result: "\u2192 100 events \u00b7 7 types \u00b7 612 ms",
    },
    {
      key: "reposByActivity",
      command: reposByActivity,
      resultStart: timeline.cmd2Out - timeline.runCard,
      result: "\u2192 5 repos ranked \u00b7 58 ms",
    },
    {
      key: "mergedPulls",
      command: mergedPulls,
      resultStart: timeline.cmd3Out - timeline.runCard,
      result: "\u2192 11 merged PRs \u00b7 28 files changed \u00b7 812 ms",
    },
  ];

  return (
    <ScaledCardShell
      enterStyle={runCardEnter}
      scale={runCardScale}
      shadow="0 24px 48px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.04)"
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
              src={ONEQUERY_ICON_SRC}
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
          ...enter(frame, timeline.terminal - timeline.runCard, 12, 8),
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

        {runSteps.map((step) =>
          step.command.status === "idle" ? null : (
            <React.Fragment key={step.key}>
              <TypedCommandLine command={step.command} />
              {step.command.status === "done" ? (
                <TerminalResultLine
                  frame={frame}
                  start={step.resultStart}
                  text={step.result}
                />
              ) : null}
            </React.Fragment>
          )
        )}
      </div>
    </ScaledCardShell>
  );
};

export const OneQueryReportCard: React.FC<{ model: OpenClawSceneModel }> = ({
  model,
}) => {
  const frame = useCurrentFrame();
  const { timeline } = model;
  const reportCardEnter = enter(frame, 0, 16, 12);
  const reportCardScale = animate(frame, 0, 16, 0.985, 1);

  return (
    <ScaledCardShell
      enterStyle={reportCardEnter}
      scale={reportCardScale}
      shadow="0 20px 40px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.04)"
    >
      <div
        style={{
          ...enter(frame, timeline.reportOverview - timeline.reportCard, 12, 6),
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
            ...enter(
              frame,
              timeline.reportNarrative - timeline.reportCard,
              12,
              4
            ),
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
        <MetricSection
          enterStyle={enter(
            frame,
            timeline.reportTypes - timeline.reportCard,
            14,
            8
          )}
          maxCount={MAX_EVENT_COUNT}
          rows={EVENT_TYPES.map((event) => ({
            key: event.type,
            label: event.type,
            count: event.count,
          }))}
          title="Events by type"
        />

        <MetricSection
          enterStyle={enter(
            frame,
            timeline.reportRepos - timeline.reportCard,
            14,
            8
          )}
          maxCount={MAX_REPO_COUNT}
          monoLabels
          rows={TOP_REPOS.map((repo) => ({
            key: repo.name,
            label: repo.name,
            count: repo.count,
          }))}
          title="Top repos"
        />
      </div>

      <div
        style={{
          ...REPORT_PANEL_STYLE,
          ...enter(frame, timeline.reportPRs - timeline.reportCard, 14, 8),
          gap: 6,
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
                ...enter(
                  frame,
                  timeline.reportPRs - timeline.reportCard + index * 2,
                  12,
                  4
                ),
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
    </ScaledCardShell>
  );
};
