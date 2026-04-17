import React from "react";
import { Sequence, useCurrentFrame } from "remotion";

import { OneQueryReportCard, OneQueryRunCard } from "./cards";
import { DEMO_TIMESTAMPS, REPORT_MESSAGE, USER_PROMPT } from "./content";
import type { OpenClawSceneModel } from "./model";
import { Avatar, Pill } from "./primitives";
import { discord, fonts } from "./theme";
import { animate, enter } from "./timing";

const MESSAGE_TEXT_MAX_WIDTH = 860;
const CHAT_MESSAGE_GRID = "40px minmax(0, 1fr)";
const CHAT_MESSAGE_GAP = 16;
const YUHA_AVATAR_BACKGROUND = "linear-gradient(135deg, #f59e0b, #d97706)";
const ONEQUERY_AVATAR_BACKGROUND = "linear-gradient(135deg, #7c3aed, #4f46e5)";
const CHAT_MESSAGE_LAYOUT_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: CHAT_MESSAGE_GRID,
  gap: CHAT_MESSAGE_GAP,
};
const BASE_MESSAGE_TEXT_STYLE: React.CSSProperties = {
  margin: 0,
  maxWidth: MESSAGE_TEXT_MAX_WIDTH,
  color: discord.text,
  lineHeight: 1.55,
};
const USER_MESSAGE_TEXT_STYLE: React.CSSProperties = {
  ...BASE_MESSAGE_TEXT_STYLE,
  fontSize: 15,
};
const ASSISTANT_MESSAGE_TEXT_STYLE: React.CSSProperties = {
  ...BASE_MESSAGE_TEXT_STYLE,
  fontSize: 14.5,
};

type MessageLayoutProps = {
  body: React.ReactNode;
  timestamp: string;
  card?: React.ReactNode;
};

type ChatHeaderProps = {
  name: string;
  timestamp: string;
  pill?: {
    text: string;
    background: string;
    color: string;
    weight?: number;
  };
};

const ChatHeader: React.FC<ChatHeaderProps> = ({ name, timestamp, pill }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <strong
      style={{
        color: discord.text,
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      {name}
    </strong>
    {pill ? (
      <Pill
        text={pill.text}
        background={pill.background}
        color={pill.color}
        weight={pill.weight}
      />
    ) : null}
    <span style={{ color: discord.textSoft, fontSize: 12 }}>{timestamp}</span>
  </div>
);

const YuhaMessageLayout: React.FC<MessageLayoutProps> = ({
  body,
  timestamp,
  card,
}) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        ...CHAT_MESSAGE_LAYOUT_STYLE,
        opacity: animate(frame, 0, 12, 0, 1),
      }}
    >
      <div style={enter(frame, 0, 12, 6)}>
        <Avatar label="Y" background={YUHA_AVATAR_BACKGROUND} color="#ffffff" />
      </div>

      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div style={enter(frame, 0, 12, 6)}>
          <ChatHeader
            name="Yuha"
            timestamp={timestamp}
            pill={{
              text: "APP",
              background: discord.blurple,
              color: "#ffffff",
              weight: 700,
            }}
          />
        </div>

        {body}
        {card}
      </div>
    </div>
  );
};

export const UserPromptMessage: React.FC<{
  model: OpenClawSceneModel;
}> = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        ...enter(frame, 0, 14, 10),
        ...CHAT_MESSAGE_LAYOUT_STYLE,
      }}
    >
      <Avatar
        label="OQ"
        background={ONEQUERY_AVATAR_BACKGROUND}
        color="#ffffff"
      />
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <ChatHeader name="OQOQ" timestamp={DEMO_TIMESTAMPS.userPrompt} />
        <p
          style={{
            ...USER_MESSAGE_TEXT_STYLE,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "1px 4px",
              borderRadius: 4,
              background: discord.mentionBg,
              color: discord.mentionText,
              fontWeight: 500,
            }}
          >
            @Yuha
          </span>{" "}
          {USER_PROMPT}
        </p>
      </div>
    </div>
  );
};

export const YuhaRunMessage: React.FC<{ model: OpenClawSceneModel }> = ({
  model,
}) => {
  const frame = useCurrentFrame();
  const { timeline } = model;
  const introStart = timeline.runMessageIntro - timeline.runMessageHeader;
  const cardStart = timeline.runCard - timeline.runMessageHeader;

  return (
    <YuhaMessageLayout
      timestamp={DEMO_TIMESTAMPS.runReply}
      body={
        <p
          style={{
            ...enter(frame, introStart, 12, 6),
            ...ASSISTANT_MESSAGE_TEXT_STYLE,
          }}
        >
          On it — running <span style={{ fontWeight: 600 }}>OneQuery</span>{" "}
          against{" "}
          <code
            style={{
              padding: "1px 6px",
              borderRadius: 4,
              background: "rgba(255, 255, 255, 0.08)",
              color: discord.text,
              fontFamily: fonts.mono,
              fontSize: 12.5,
            }}
          >
            github-openclaw
          </code>{" "}
          read-only. I&apos;ll aggregate with jq and drop the breakdown here.
        </p>
      }
      card={
        <Sequence from={cardStart} layout="none" name="onequery-run-card">
          <OneQueryRunCard model={model} />
        </Sequence>
      }
    />
  );
};

export const YuhaReportMessage: React.FC<{ model: OpenClawSceneModel }> = ({
  model,
}) => {
  const frame = useCurrentFrame();
  const { timeline } = model;
  const introStart = timeline.reportMessageIntro - timeline.reportMessageHeader;
  const cardStart = timeline.reportCard - timeline.reportMessageHeader;

  return (
    <YuhaMessageLayout
      timestamp={DEMO_TIMESTAMPS.reportReply}
      body={
        <p
          style={{
            ...enter(frame, introStart, 12, 6),
            ...ASSISTANT_MESSAGE_TEXT_STYLE,
          }}
        >
          {REPORT_MESSAGE}
        </p>
      }
      card={
        <Sequence from={cardStart} layout="none" name="onequery-report-card">
          <OneQueryReportCard model={model} />
        </Sequence>
      }
    />
  );
};
