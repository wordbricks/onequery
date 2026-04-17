import React from "react";
import { Sequence, useCurrentFrame } from "remotion";

import {
  discordAvatarBackgrounds,
  discordWorkspace,
  messageTimestamps,
  reportReplyText,
  runReplyCopy,
  userPromptText,
} from "../fixtures/discord";
import type { OpenClawDemoSceneState } from "../scene-state";
import { getFadeSlideInStyle, interpolateSceneValue } from "../timeline";
import { discordTokens, fontFamilies } from "../tokens";
import { OneQueryReportSummaryCard } from "./report-summary-card";
import { OneQueryRunSummaryCard } from "./run-summary-card";
import { AvatarBadge, StatusPill } from "./ui";

const messageTextMaxWidth = 860;
const chatMessageLayoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "40px minmax(0, 1fr)",
  gap: 16,
};
const baseMessageTextStyle: React.CSSProperties = {
  margin: 0,
  maxWidth: messageTextMaxWidth,
  color: discordTokens.text,
  lineHeight: 1.55,
};
const userMessageTextStyle: React.CSSProperties = {
  ...baseMessageTextStyle,
  fontSize: 15,
};
const assistantMessageTextStyle: React.CSSProperties = {
  ...baseMessageTextStyle,
  fontSize: 14.5,
};
const sourceReferenceStyle: React.CSSProperties = {
  padding: "1px 6px",
  borderRadius: 4,
  background: "rgba(255, 255, 255, 0.08)",
  color: discordTokens.text,
  fontFamily: fontFamilies.mono,
  fontSize: 12.5,
};

type ChatThreadProps = {
  sceneState: OpenClawDemoSceneState;
};

type MessageHeaderBadge = {
  background: string;
  color: string;
  fontWeight?: number;
  text: string;
};

type AssistantMessageShellProps = {
  body: React.ReactNode;
  card?: React.ReactNode;
  timestamp: string;
};

type AssistantReplyMessageRowProps = {
  bodyContent: React.ReactNode;
  card: React.ReactNode;
  cardSequenceName: string;
  cardStartFrame: number;
  introStartFrame: number;
  timestamp: string;
};

type ChatMessageHeaderProps = {
  badge?: MessageHeaderBadge;
  name: string;
  timestamp: string;
};

const ChatMessageHeader: React.FC<ChatMessageHeaderProps> = ({
  badge,
  name,
  timestamp,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <strong
      style={{
        color: discordTokens.text,
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      {name}
    </strong>

    {badge ? (
      <StatusPill
        text={badge.text}
        background={badge.background}
        color={badge.color}
        fontWeight={badge.fontWeight}
      />
    ) : null}

    <span style={{ color: discordTokens.textSoft, fontSize: 12 }}>
      {timestamp}
    </span>
  </div>
);

const AssistantMessageShell: React.FC<AssistantMessageShellProps> = ({
  body,
  card,
  timestamp,
}) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        ...chatMessageLayoutStyle,
        opacity: interpolateSceneValue(frame, 0, 12, 0, 1),
      }}
    >
      <div style={getFadeSlideInStyle(frame, 0, 12, 6)}>
        <AvatarBadge
          label="Y"
          background={discordAvatarBackgrounds.assistant}
          color="#ffffff"
        />
      </div>

      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div style={getFadeSlideInStyle(frame, 0, 12, 6)}>
          <ChatMessageHeader
            name={discordWorkspace.assistantName}
            timestamp={timestamp}
            badge={{
              text: "APP",
              background: discordTokens.blurple,
              color: "#ffffff",
              fontWeight: 700,
            }}
          />
        </div>

        {body}
        {card}
      </div>
    </div>
  );
};

const UserPromptMessageRow: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        ...getFadeSlideInStyle(frame, 0, 14, 10),
        ...chatMessageLayoutStyle,
      }}
    >
      <AvatarBadge
        label="OQ"
        background={discordAvatarBackgrounds.currentUser}
        color="#ffffff"
      />

      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <ChatMessageHeader
          name={discordWorkspace.currentUserName}
          timestamp={messageTimestamps.userPrompt}
        />

        <p style={userMessageTextStyle}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "1px 4px",
              borderRadius: 4,
              background: discordTokens.mentionBackground,
              color: discordTokens.mentionText,
              fontWeight: 500,
            }}
          >
            @{discordWorkspace.assistantName}
          </span>{" "}
          {userPromptText}
        </p>
      </div>
    </div>
  );
};

const AssistantReplyMessageRow: React.FC<AssistantReplyMessageRowProps> = ({
  bodyContent,
  card,
  cardSequenceName,
  cardStartFrame,
  introStartFrame,
  timestamp,
}) => {
  const frame = useCurrentFrame();

  return (
    <AssistantMessageShell
      timestamp={timestamp}
      body={
        <p
          style={{
            ...getFadeSlideInStyle(frame, introStartFrame, 12, 6),
            ...assistantMessageTextStyle,
          }}
        >
          {bodyContent}
        </p>
      }
      card={
        <Sequence from={cardStartFrame} layout="none" name={cardSequenceName}>
          {card}
        </Sequence>
      }
    />
  );
};

export const OpenClawChatThread: React.FC<ChatThreadProps> = ({
  sceneState,
}) => {
  const { timeline } = sceneState;
  const chatSequences = [
    {
      from: timeline.userPromptMessage - timeline.windowMount,
      name: "user-prompt-message",
      content: <UserPromptMessageRow />,
    },
    {
      from: timeline.runReplyHeader - timeline.windowMount,
      name: "assistant-run-reply",
      content: (
        <AssistantReplyMessageRow
          timestamp={messageTimestamps.runReply}
          introStartFrame={timeline.runReplyIntro - timeline.runReplyHeader}
          cardStartFrame={timeline.runReplyCard - timeline.runReplyHeader}
          cardSequenceName="onequery-run-summary-card"
          bodyContent={
            <>
              {runReplyCopy.beforeSource}{" "}
              <code style={sourceReferenceStyle}>
                {runReplyCopy.sourceName}
              </code>{" "}
              {runReplyCopy.afterSource}
            </>
          }
          card={<OneQueryRunSummaryCard sceneState={sceneState} />}
        />
      ),
    },
    {
      from: timeline.reportReplyHeader - timeline.windowMount,
      name: "assistant-report-reply",
      content: (
        <AssistantReplyMessageRow
          timestamp={messageTimestamps.reportReply}
          introStartFrame={
            timeline.reportReplyIntro - timeline.reportReplyHeader
          }
          cardStartFrame={timeline.reportReplyCard - timeline.reportReplyHeader}
          cardSequenceName="onequery-report-summary-card"
          bodyContent={reportReplyText}
          card={<OneQueryReportSummaryCard sceneState={sceneState} />}
        />
      ),
    },
  ] as const;

  return (
    <>
      {chatSequences.map((chatSequence) => (
        <Sequence
          key={chatSequence.name}
          from={chatSequence.from}
          layout="none"
          name={chatSequence.name}
        >
          {chatSequence.content}
        </Sequence>
      ))}
    </>
  );
};
