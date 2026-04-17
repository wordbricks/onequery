import React from "react";

import {
  activeDiscordChannel,
  discordAvatarBackgrounds,
  discordChannels,
  discordWorkspace,
} from "../fixtures/discord";
import type { OpenClawDemoSceneState } from "../scene-state";
import { framesFromSeconds, getFadeSlideInStyle } from "../timeline";
import { discordTokens } from "../tokens";
import { AvatarBadge } from "./ui";

const discordWindowWidth = 1348;
const discordWindowHeight = 892;
const relatedServerBadges = [
  { label: "WB", background: "#404249" },
  { label: "AI", background: "#404249" },
  { label: "QA", background: "#404249" },
] as const;

type DiscordWorkspaceFrameProps = {
  children: React.ReactNode;
  sceneState: OpenClawDemoSceneState;
};

type SceneStateProps = {
  sceneState: OpenClawDemoSceneState;
};

const ServerRail: React.FC<SceneStateProps> = ({ sceneState }) => {
  const { frame, fps, timeline } = sceneState;

  return (
    <aside
      style={{
        ...getFadeSlideInStyle(frame, timeline.serverRailEnter, 14, 8),
        background: discordTokens.rail,
        padding: "16px 0",
        display: "grid",
        gridTemplateRows: "auto 1fr",
        justifyItems: "center",
        gap: 14,
      }}
    >
      <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
        <div
          style={{
            position: "relative",
            width: 48,
            height: 48,
            borderRadius: 14,
            background: "linear-gradient(135deg, #5865f2, #3a44b8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "-0.04em",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: -14,
              width: 4,
              height: 40,
              borderRadius: 4,
              background: "#ffffff",
            }}
          />
          OC
        </div>

        {relatedServerBadges.map((serverBadge, index) => (
          <div
            key={serverBadge.label}
            style={{
              ...getFadeSlideInStyle(
                frame,
                timeline.serverRailEnter +
                  framesFromSeconds(0.08 + index * 0.05, fps),
                10,
                6
              ),
              width: 48,
              height: 48,
              borderRadius: 24,
              background: serverBadge.background,
              color: discordTokens.textMuted,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {serverBadge.label}
          </div>
        ))}
      </div>

      <div />
    </aside>
  );
};

const ChannelSidebar: React.FC<SceneStateProps> = ({ sceneState }) => {
  const { frame, fps, timeline } = sceneState;

  return (
    <aside
      style={{
        ...getFadeSlideInStyle(frame, timeline.channelSidebarEnter, 14, 8),
        background: discordTokens.sidebar,
        display: "grid",
        gridTemplateRows: "auto auto 1fr auto",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          height: 52,
          borderBottom: "1px solid rgba(0, 0, 0, 0.25)",
          boxShadow: "0 1px 0 rgba(255, 255, 255, 0.02)",
        }}
      >
        <strong
          style={{
            color: discordTokens.text,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          {discordWorkspace.serverName}
        </strong>

        <span
          style={{
            color: discordTokens.textSoft,
            fontSize: 16,
            fontWeight: 500,
            lineHeight: 1,
          }}
        >
          {"\u2304"}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gap: 2,
          padding: "14px 8px 0",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "0 8px 4px",
            color: discordTokens.textSoft,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          <span>{"\u25BE"}</span>
          <span>Text channels</span>
        </div>

        {discordChannels.map((channelName, index) => {
          const isActiveChannel = channelName === activeDiscordChannel;

          return (
            <div
              key={channelName}
              style={{
                ...getFadeSlideInStyle(
                  frame,
                  timeline.channelListEnter +
                    framesFromSeconds(0.06 * index, fps),
                  10,
                  6
                ),
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 30,
                padding: "0 10px",
                borderRadius: 6,
                background: isActiveChannel
                  ? "rgba(255, 255, 255, 0.07)"
                  : "transparent",
                color: isActiveChannel
                  ? discordTokens.text
                  : discordTokens.textSoft,
                fontSize: 14,
                fontWeight: isActiveChannel ? 500 : 400,
              }}
            >
              <span style={{ color: discordTokens.textFaint, fontSize: 16 }}>
                #
              </span>
              <span>{channelName}</span>
            </div>
          );
        })}
      </div>

      <div />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          background: "#232428",
        }}
      >
        <div style={{ position: "relative" }}>
          <AvatarBadge
            label="OQ"
            background={discordAvatarBackgrounds.currentUser}
            color="#ffffff"
            size={32}
          />
          <span
            style={{
              position: "absolute",
              right: -2,
              bottom: -2,
              width: 12,
              height: 12,
              borderRadius: 6,
              background: discordTokens.success,
              boxShadow: "0 0 0 3px #232428",
            }}
          />
        </div>

        <div style={{ display: "grid", gap: 1 }}>
          <strong
            style={{
              color: discordTokens.text,
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.2,
            }}
          >
            {discordWorkspace.currentUserName}
          </strong>
          <span
            style={{
              color: discordTokens.textSoft,
              fontSize: 11,
              lineHeight: 1.2,
            }}
          >
            {discordWorkspace.currentUserStatus}
          </span>
        </div>
      </div>
    </aside>
  );
};

const WorkspaceHeader: React.FC<SceneStateProps> = ({ sceneState }) => {
  const { frame, timeline } = sceneState;

  return (
    <div
      style={{
        ...getFadeSlideInStyle(frame, timeline.threadHeaderEnter, 12, 6),
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 20px",
        borderBottom: "1px solid rgba(0, 0, 0, 0.25)",
        boxShadow: "0 1px 0 rgba(255, 255, 255, 0.02)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            color: discordTokens.textSoft,
            fontSize: 20,
            fontWeight: 500,
          }}
        >
          #
        </span>
        <strong
          style={{
            color: discordTokens.text,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          {discordWorkspace.channelName}
        </strong>
      </div>

      <span
        style={{
          width: 1,
          height: 20,
          background: discordTokens.dividerStrong,
        }}
      />

      <span
        style={{
          color: discordTokens.textSoft,
          fontSize: 13,
          lineHeight: 1.4,
        }}
      >
        {discordWorkspace.channelDescription}
      </span>
    </div>
  );
};

export const DiscordWorkspaceFrame: React.FC<DiscordWorkspaceFrameProps> = ({
  children,
  sceneState,
}) => {
  const { frame, timeline, discordWindowScale } = sceneState;
  const windowEntryStyle = getFadeSlideInStyle(
    frame,
    timeline.windowMount,
    20,
    14
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          ...windowEntryStyle,
          width: discordWindowWidth,
          height: discordWindowHeight,
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "72px 240px minmax(0, 1fr)",
          borderRadius: 16,
          background: discordTokens.main,
          boxShadow:
            "0 40px 80px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.08)",
          transform: `${windowEntryStyle.transform} scale(${discordWindowScale})`,
        }}
      >
        <ServerRail sceneState={sceneState} />
        <ChannelSidebar sceneState={sceneState} />

        <main
          style={{
            display: "grid",
            gridTemplateRows: "52px minmax(0, 1fr)",
            minWidth: 0,
            background: discordTokens.main,
          }}
        >
          <WorkspaceHeader sceneState={sceneState} />

          <div
            style={{
              minHeight: 0,
              padding: "12px 24px 14px",
              display: "grid",
              alignContent: "start",
              gap: 10,
            }}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
