import React from "react";

import { OneQueryReportCard, OneQueryRunCard } from "./cards";
import { REPORT_MESSAGE, USER_PROMPT } from "./content";
import type { OpenClawSceneModel } from "./model";
import { Avatar, Pill } from "./primitives";
import { discord, fonts } from "./theme";
import { animate, enter } from "./timing";

const MESSAGE_TEXT_MAX_WIDTH = 860;

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
        gridTemplateColumns: "40px minmax(0, 1fr)",
        gap: 16,
      }}
    >
      <Avatar
        label="OQ"
        background="linear-gradient(135deg, #7c3aed, #4f46e5)"
        color="#ffffff"
      />
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
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

  if (frame < timeline.runMessageHeader) {
    return null;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "40px minmax(0, 1fr)",
        gap: 16,
        opacity: animate(frame, timeline.runMessageHeader, 12, 0, 1),
      }}
    >
      <div style={enter(frame, timeline.runMessageHeader, 12, 6)}>
        <Avatar
          label="Y"
          background="linear-gradient(135deg, #f59e0b, #d97706)"
          color="#ffffff"
        />
      </div>

      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div style={enter(frame, timeline.runMessageHeader, 12, 6)}>
          <MessageHeader timestamp="Today at 2:46 PM" />
        </div>

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

        <OneQueryRunCard model={model} />
      </div>
    </div>
  );
};

export const YuhaReportMessage: React.FC<{ model: OpenClawSceneModel }> = ({
  model,
}) => {
  const { frame, timeline } = model;

  if (frame < timeline.reportMessageHeader) {
    return null;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "40px minmax(0, 1fr)",
        gap: 16,
        opacity: animate(frame, timeline.reportMessageHeader, 12, 0, 1),
      }}
    >
      <div style={enter(frame, timeline.reportMessageHeader, 12, 6)}>
        <Avatar
          label="Y"
          background="linear-gradient(135deg, #f59e0b, #d97706)"
          color="#ffffff"
        />
      </div>

      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div style={enter(frame, timeline.reportMessageHeader, 12, 6)}>
          <MessageHeader timestamp="Today at 2:47 PM" />
        </div>

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

        <OneQueryReportCard model={model} />
      </div>
    </div>
  );
};
