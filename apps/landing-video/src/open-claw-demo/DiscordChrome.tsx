import React from "react";

import { ACTIVE_CHANNEL, CHANNELS } from "./content";
import type { OpenClawSceneModel } from "./model";
import { Avatar } from "./primitives";
import { discord } from "./theme";
import { enter, seconds } from "./timing";

const WINDOW_WIDTH = 1348;
const WINDOW_HEIGHT = 892;

export const DiscordChrome: React.FC<{
  children: React.ReactNode;
  model: OpenClawSceneModel;
}> = ({ children, model }) => {
  const {
    frame,
    fps,
    scene: { hasChrome },
    timeline,
    windowScale,
  } = model;

  if (!hasChrome) {
    return null;
  }

  const windowEnter = enter(frame, timeline.window, 20, 14);

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
          ...windowEnter,
          width: WINDOW_WIDTH,
          height: WINDOW_HEIGHT,
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "72px 240px minmax(0, 1fr)",
          borderRadius: 16,
          background: discord.main,
          boxShadow:
            "0 40px 80px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.08)",
          transform: `${windowEnter.transform} scale(${windowScale})`,
        }}
      >
        <aside
          style={{
            ...enter(frame, timeline.rail, 14, 8),
            background: discord.rail,
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

            {[
              { label: "WB", bg: "#404249" },
              { label: "AI", bg: "#404249" },
              { label: "QA", bg: "#404249" },
            ].map((server, index) => (
              <div
                key={server.label}
                style={{
                  ...enter(
                    frame,
                    timeline.rail + seconds(0.08 + index * 0.05, fps),
                    10,
                    6
                  ),
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  background: server.bg,
                  color: discord.textMuted,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                }}
              >
                {server.label}
              </div>
            ))}
          </div>

          <div />
        </aside>

        <aside
          style={{
            ...enter(frame, timeline.sidebar, 14, 8),
            background: discord.sidebar,
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
                color: discord.text,
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              OpenClaw
            </strong>
            <span
              style={{
                color: discord.textSoft,
                fontSize: 16,
                fontWeight: 500,
                lineHeight: 1,
              }}
            >
              ⌄
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
                color: discord.textSoft,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              <span>▾</span>
              <span>Text channels</span>
            </div>

            {CHANNELS.map((channel, index) => {
              const active = channel === ACTIVE_CHANNEL;

              return (
                <div
                  key={channel}
                  style={{
                    ...enter(
                      frame,
                      timeline.channels + seconds(0.06 * index, fps),
                      10,
                      6
                    ),
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    height: 30,
                    padding: "0 10px",
                    borderRadius: 6,
                    background: active
                      ? "rgba(255, 255, 255, 0.07)"
                      : "transparent",
                    color: active ? discord.text : discord.textSoft,
                    fontSize: 14,
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  <span style={{ color: discord.textFaint, fontSize: 16 }}>
                    #
                  </span>
                  <span>{channel}</span>
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
              <Avatar
                label="OQ"
                background="linear-gradient(135deg, #7c3aed, #4f46e5)"
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
                  background: discord.success,
                  boxShadow: "0 0 0 3px #232428",
                }}
              />
            </div>
            <div style={{ display: "grid", gap: 1 }}>
              <strong
                style={{
                  color: discord.text,
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1.2,
                }}
              >
                OQOQ
              </strong>
              <span
                style={{
                  color: discord.textSoft,
                  fontSize: 11,
                  lineHeight: 1.2,
                }}
              >
                online
              </span>
            </div>
          </div>
        </aside>

        <main
          style={{
            display: "grid",
            gridTemplateRows: "52px minmax(0, 1fr)",
            minWidth: 0,
            background: discord.main,
          }}
        >
          <div
            style={{
              ...enter(frame, timeline.header, 12, 6),
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
                  color: discord.textSoft,
                  fontSize: 20,
                  fontWeight: 500,
                }}
              >
                #
              </span>
              <strong
                style={{
                  color: discord.text,
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                }}
              >
                plugin-demo
              </strong>
            </div>
            <span
              style={{
                width: 1,
                height: 20,
                background: discord.dividerStrong,
              }}
            />
            <span
              style={{
                color: discord.textSoft,
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              OpenClaw agent answers GitHub questions using the OneQuery plugin.
            </span>
          </div>

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
