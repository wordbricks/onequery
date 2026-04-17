import React from "react";
import { useCurrentFrame } from "remotion";

import {
  eventTypeCounts,
  maxEventTypeCount,
  maxRepositoryActivityCount,
  mergedPullRequests,
  overviewMetrics,
  reportNarrative,
  repositoryActivityCounts,
} from "../fixtures/report";
import type { OpenClawDemoSceneState } from "../scene-state";
import { getFadeSlideInStyle, interpolateSceneValue } from "../timeline";
import { fontFamilies, surfaceTokens } from "../tokens";
import { SummaryCardShell } from "./summary-card-shell";
import { MetricBar, SectionEyebrow } from "./ui";

const reportPanelStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
  padding: "8px 10px 10px",
  borderRadius: 10,
  border: `1px solid ${surfaceTokens.line}`,
  background: surfaceTokens.surface,
};

const metricRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr) 24px",
  alignItems: "center",
  gap: 10,
};

type ReportSummaryCardProps = {
  sceneState: OpenClawDemoSceneState;
};

type MetricPanelProps = {
  entryStyle: React.CSSProperties;
  maxCount: number;
  rows: readonly {
    count: number;
    key: string | number;
    label: string;
  }[];
  title: string;
  useMonospaceLabels?: boolean;
};

const MetricPanel: React.FC<MetricPanelProps> = ({
  entryStyle,
  maxCount,
  rows,
  title,
  useMonospaceLabels = false,
}) => (
  <div
    style={{
      ...reportPanelStyle,
      ...entryStyle,
    }}
  >
    <SectionEyebrow text={title} />
    <div style={{ display: "grid", gap: 5 }}>
      {rows.map((row) => (
        <div key={row.key} style={metricRowStyle}>
          <span
            style={{
              color: surfaceTokens.ink,
              fontSize: 11.5,
              fontWeight: 500,
              fontFamily: useMonospaceLabels ? fontFamilies.mono : undefined,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.label}
          </span>

          <MetricBar percent={(row.count / maxCount) * 100} />

          <span
            style={{
              color: surfaceTokens.textMuted,
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

export const OneQueryReportSummaryCard: React.FC<ReportSummaryCardProps> = ({
  sceneState,
}) => {
  const frame = useCurrentFrame();
  const { timeline } = sceneState;
  const cardEntryStyle = getFadeSlideInStyle(frame, 0, 16, 12);
  const cardScale = interpolateSceneValue(frame, 0, 16, 0.985, 1);

  return (
    <SummaryCardShell
      entryStyle={cardEntryStyle}
      scale={cardScale}
      shadow="0 20px 40px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.04)"
    >
      <div
        style={{
          ...getFadeSlideInStyle(
            frame,
            timeline.reportOverview - timeline.reportReplyCard,
            12,
            6
          ),
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          alignItems: "center",
          gap: 10,
          padding: "7px 9px",
          borderRadius: 10,
          background: surfaceTokens.surfaceMuted,
          border: `1px solid ${surfaceTokens.line}`,
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
          {overviewMetrics.map((metric) => (
            <div
              key={metric.label}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 5,
                minWidth: 0,
                padding: "5px 7px",
                borderRadius: 8,
                background: surfaceTokens.surface,
                border: `1px solid ${surfaceTokens.lineSoft}`,
              }}
            >
              <strong
                style={{
                  color: surfaceTokens.ink,
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                {metric.value}
              </strong>
              <span
                style={{
                  color: surfaceTokens.textMuted,
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                {metric.label.toLowerCase()}
              </span>
            </div>
          ))}
        </div>

        <span
          style={{
            ...getFadeSlideInStyle(
              frame,
              timeline.reportNarrative - timeline.reportReplyCard,
              12,
              4
            ),
            minWidth: 0,
            color: surfaceTokens.textMuted,
            fontSize: 11,
            fontWeight: 500,
            fontStyle: "italic",
            textAlign: "right",
            lineHeight: 1.45,
          }}
        >
          {reportNarrative}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <MetricPanel
          entryStyle={getFadeSlideInStyle(
            frame,
            timeline.eventTypePanel - timeline.reportReplyCard,
            14,
            8
          )}
          maxCount={maxEventTypeCount}
          rows={eventTypeCounts.map((eventType) => ({
            key: eventType.name,
            label: eventType.name,
            count: eventType.count,
          }))}
          title="Events by type"
        />

        <MetricPanel
          entryStyle={getFadeSlideInStyle(
            frame,
            timeline.repositoryPanel - timeline.reportReplyCard,
            14,
            8
          )}
          maxCount={maxRepositoryActivityCount}
          rows={repositoryActivityCounts.map((repository) => ({
            key: repository.name,
            label: repository.name,
            count: repository.count,
          }))}
          title="Top repos"
          useMonospaceLabels
        />
      </div>

      <div
        style={{
          ...reportPanelStyle,
          ...getFadeSlideInStyle(
            frame,
            timeline.mergedPullRequestPanel - timeline.reportReplyCard,
            14,
            8
          ),
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
          <SectionEyebrow text="Merged PRs | openclaw/plugin" />
          <span
            style={{
              color: surfaceTokens.textFaint,
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: "0.02em",
            }}
          >
            showing 3 of 11
          </span>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          {mergedPullRequests.map((pullRequest, index) => (
            <div
              key={pullRequest.number}
              style={{
                ...getFadeSlideInStyle(
                  frame,
                  timeline.mergedPullRequestPanel -
                    timeline.reportReplyCard +
                    index * 2,
                  12,
                  4
                ),
                display: "grid",
                gridTemplateColumns: "52px minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 12,
                padding: "2px 0",
                borderTop:
                  index === 0 ? "none" : `1px solid ${surfaceTokens.lineSoft}`,
              }}
            >
              <span
                style={{
                  color: surfaceTokens.textSoft,
                  fontSize: 11.5,
                  fontFamily: fontFamilies.mono,
                  fontWeight: 500,
                }}
              >
                #{pullRequest.number}
              </span>

              <span
                style={{
                  color: surfaceTokens.ink,
                  fontSize: 12,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {pullRequest.title}
              </span>

              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: surfaceTokens.textMuted,
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    color: surfaceTokens.ink,
                    fontWeight: 500,
                    fontFamily: fontFamilies.mono,
                  }}
                >
                  @{pullRequest.author}
                </span>
                <span style={{ color: surfaceTokens.textFaint }}>|</span>
                <span>{pullRequest.mergedAt}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </SummaryCardShell>
  );
};
