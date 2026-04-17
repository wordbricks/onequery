import React from "react";

import { OneQueryReportCard, OneQueryRunCard } from "./cards";
import { REPORT_MESSAGE, USER_PROMPT } from "./content";
import type { OpenClawSceneModel } from "./model";
import { Avatar, Pill } from "./primitives";
import { discord, fonts } from "./theme";
import { animate, enter } from "./timing";

const MESSAGE_TEXT_MAX_WIDTH = 860;
const CHAT_MESSAGE_GRID = "40px minmax(0, 1fr)";
const CHAT_MESSAGE_GAP = 16;
const YUHA_AVATAR_BACKGROUND = "linear-gradient(135deg, #f59e0b, #d97706)";
const ONEQUERY_AVATAR_BACKGROUND = "linear-gradient(135deg, #7c3aed, #4f46e5)";

type MessageLayoutProps = {
  model: OpenClawSceneModel;
  headerStart: number;
  body: React.ReactNode;
  timestamp: string;
  card?: React.ReactNode;
};

const MessageHeader: React.FC<{ timestamp: string }> = ({ timestamp }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <strong
      style={{
        color: discord.text,
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      Yuha
    </strong>
    <Pill
      text="APP"
      background={discord.blurple}
      color="#ffffff"
      weight={700}
    />
    <span style={{ color: discord.textSoft, fontSize: 12 }}>{timestamp}</span>
  </div>
);

const UserHeader: React.FC = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <strong
      style={{
        color: discord.text,
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      OQOQ
    </strong>
    <span style={{ color: discord.textSoft, fontSize: 12 }}>
      Today at 2:46 PM
    </span>
  </div>
);

const YuhaMessageLayout: React.FC<MessageLayoutProps> = ({
  model,
  headerStart,
  body,
  timestamp,
  card,
}) => {
  const { frame } = model;

  if (frame < headerStart) {
    return null;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: CHAT_MESSAGE_GRID,
        gap: CHAT_MESSAGE_GAP,
        opacity: animate(frame, headerStart, 12, 0, 1),
      }}
    >
      <div style={enter(frame, headerStart, 12, 6)}>
        <Avatar label="Y" background={YUHA_AVATAR_BACKGROUND} color="#ffffff" />
      </div>

      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div style={enter(frame, headerStart, 12, 6)}>
          <MessageHeader timestamp={timestamp} />
        </div>

        {body}
        {card}
      </div>
    </div>
  );
};

export const UserPromptMessage: React.FC<{ model: OpenClawSceneModel }> = ({
  model,
}) => {
  const { frame, timeline } = model;

  if (frame < timeline.userMessage) {
    return null;
  }

  return (
    <div
      style={{
        ...enter(frame, timeline.userMessage, 14, 10),
        display: "grid",
        gridTemplateColumns: CHAT_MESSAGE_GRID,
        gap: CHAT_MESSAGE_GAP,
      }}
    >
      <Avatar
        label="OQ"
        background={ONEQUERY_AVATAR_BACKGROUND}
        color="#ffffff"
      />
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <UserHeader />
        <p
          style={{
            margin: 0,
            maxWidth: MESSAGE_TEXT_MAX_WIDTH,
            color: discord.text,
            fontSize: 15,
            lineHeight: 1.55,
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
  const { frame, timeline } = model;

  return (
    <YuhaMessageLayout
      model={model}
      headerStart={timeline.runMessageHeader}
      timestamp="Today at 2:46 PM"
      body={
        <p
          style={{
            ...enter(frame, timeline.runMessageIntro, 12, 6),
            margin: 0,
            maxWidth: MESSAGE_TEXT_MAX_WIDTH,
            color: discord.text,
            fontSize: 14.5,
            lineHeight: 1.55,
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
      card={<OneQueryRunCard model={model} />}
    />
  );
};

export const YuhaReportMessage: React.FC<{ model: OpenClawSceneModel }> = ({
  model,
}) => {
  const { frame, timeline } = model;

  return (
    <YuhaMessageLayout
      model={model}
      headerStart={timeline.reportMessageHeader}
      timestamp="Today at 2:47 PM"
      body={
        <p
          style={{
            ...enter(frame, timeline.reportMessageIntro, 12, 6),
            margin: 0,
            maxWidth: MESSAGE_TEXT_MAX_WIDTH,
            color: discord.text,
            fontSize: 14.5,
            lineHeight: 1.55,
          }}
        >
          {REPORT_MESSAGE}
        </p>
      }
      card={<OneQueryReportCard model={model} />}
    />
  );
};
