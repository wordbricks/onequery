import React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";

import { terminalCommands, terminalStepSummaries } from "../fixtures/terminal";
import { buildCommandRenderState } from "../scene-state";
import type {
  CommandRenderState,
  OpenClawDemoSceneState,
} from "../scene-state";
import { getFadeSlideInStyle, interpolateSceneValue } from "../timeline";
import { fontFamilies, surfaceTokens } from "../tokens";
import { SummaryCardShell } from "./summary-card-shell";
import { CommandLine, StatusPill } from "./ui";

const oneQueryIconSource = staticFile("onequery-icon.png");

type RunSummaryCardProps = {
  sceneState: OpenClawDemoSceneState;
};

type RunStepKey = keyof typeof terminalCommands;

type RunStep = {
  key: RunStepKey;
  commandState: CommandRenderState;
  resultStartFrame: number;
  resultText: string;
};

type RunStepDefinition = {
  commandFrameKey:
    | "eventTypeBreakdownCommand"
    | "repositoryActivityBreakdownCommand"
    | "mergedPullRequestSummaryCommand";
  key: RunStepKey;
  resultFrameKey:
    | "eventTypeBreakdownResult"
    | "repositoryActivityBreakdownResult"
    | "mergedPullRequestSummaryResult";
};

const runStepDefinitions = [
  {
    key: "eventTypeBreakdown",
    commandFrameKey: "eventTypeBreakdownCommand",
    resultFrameKey: "eventTypeBreakdownResult",
  },
  {
    key: "repositoryActivityBreakdown",
    commandFrameKey: "repositoryActivityBreakdownCommand",
    resultFrameKey: "repositoryActivityBreakdownResult",
  },
  {
    key: "mergedPullRequestSummary",
    commandFrameKey: "mergedPullRequestSummaryCommand",
    resultFrameKey: "mergedPullRequestSummaryResult",
  },
] as const satisfies readonly RunStepDefinition[];

const TerminalResultLine: React.FC<{
  frame: number;
  startFrame: number;
  text: string;
}> = ({ frame, startFrame, text }) => (
  <div
    style={{
      ...getFadeSlideInStyle(frame, startFrame, 10, 4),
      paddingLeft: 18,
      color: surfaceTokens.terminalMuted,
      fontSize: 11.5,
    }}
  >
    {text}
  </div>
);

export const OneQueryRunSummaryCard: React.FC<RunSummaryCardProps> = ({
  sceneState,
}) => {
  const frame = useCurrentFrame();
  const { timeline } = sceneState;
  const cardStartFrame = timeline.runReplyCard;
  const cardEntryStyle = getFadeSlideInStyle(frame, 0, 16, 12);
  const cardScale = interpolateSceneValue(frame, 0, 16, 0.975, 1);
  const runSteps: readonly RunStep[] = runStepDefinitions.map((runStep) => ({
    key: runStep.key,
    commandState: buildCommandRenderState(
      frame,
      timeline[runStep.commandFrameKey] - cardStartFrame,
      terminalCommands[runStep.key]
    ),
    resultStartFrame: timeline[runStep.resultFrameKey] - cardStartFrame,
    resultText: terminalStepSummaries[runStep.key],
  }));

  return (
    <SummaryCardShell
      entryStyle={cardEntryStyle}
      scale={cardScale}
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
              background: surfaceTokens.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.08)",
            }}
          >
            <Img
              src={oneQueryIconSource}
              style={{ width: 32, height: 32, display: "block" }}
            />
          </div>

          <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
            <strong
              style={{
                color: surfaceTokens.ink,
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
                color: surfaceTokens.textMuted,
                fontSize: 11.5,
                lineHeight: 1.3,
              }}
            >
              <span>OpenClaw plugin</span>
              <span>|</span>
              <span>github-openclaw source</span>
              <span>|</span>
              <span>
                request-id{" "}
                <code
                  style={{
                    fontFamily: fontFamilies.mono,
                    fontSize: 11,
                    color: surfaceTokens.ink,
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
          <StatusPill
            text="Read-only"
            background={surfaceTokens.successBackground}
            color={surfaceTokens.successText}
          />
          <StatusPill
            text="Connected"
            background={surfaceTokens.wash}
            color={surfaceTokens.ink}
          />
        </div>
      </div>

      <div
        style={{
          ...getFadeSlideInStyle(
            frame,
            timeline.runTerminalPanel - cardStartFrame,
            12,
            8
          ),
          display: "grid",
          gap: 7,
          padding: "8px 12px 10px",
          borderRadius: 10,
          background: surfaceTokens.terminalBackground,
          border: `1px solid ${surfaceTokens.terminalBorder}`,
          fontFamily: fontFamilies.mono,
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
            borderBottom: `1px solid ${surfaceTokens.terminalBorder}`,
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
                  background: surfaceTokens.terminalSoft,
                }}
              />
            ))}
          </div>

          <span
            style={{
              color: surfaceTokens.terminalMuted,
              fontSize: 10.5,
              letterSpacing: "0.02em",
            }}
          >
            onequery | plugin run
          </span>
        </div>

        {runSteps.map((runStep) =>
          runStep.commandState.typingStatus === "idle" ? null : (
            <React.Fragment key={runStep.key}>
              <CommandLine commandState={runStep.commandState} />
              {runStep.commandState.typingStatus === "done" ? (
                <TerminalResultLine
                  frame={frame}
                  startFrame={runStep.resultStartFrame}
                  text={runStep.resultText}
                />
              ) : null}
            </React.Fragment>
          )
        )}
      </div>
    </SummaryCardShell>
  );
};
