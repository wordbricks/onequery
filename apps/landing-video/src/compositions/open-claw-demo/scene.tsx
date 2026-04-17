import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";

import { DiscordWorkspaceFrame } from "./components/discord-workspace-frame";
import { OpenClawChatThread } from "./components/open-claw-chat-thread";
import { openClawDemoFps } from "./config";
import type { OpenClawDemoProps } from "./props";
import { buildOpenClawDemoSceneState } from "./scene-state";
import { fontFamilies } from "./tokens";

export const OpenClawDemoScene: React.FC<OpenClawDemoProps> = () => {
  const frame = useCurrentFrame();
  const sceneState = buildOpenClawDemoSceneState(frame, openClawDemoFps);

  return (
    <AbsoluteFill
      style={{
        background: "#ffffff",
        fontFamily: fontFamilies.sans,
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 10% 6%, rgba(0, 0, 0, 0.045), transparent 32%), radial-gradient(circle at 94% 96%, rgba(0, 0, 0, 0.035), transparent 30%)",
        }}
      />

      <Sequence
        from={sceneState.timeline.windowMount}
        layout="none"
        name="discord-workspace"
      >
        <DiscordWorkspaceFrame sceneState={sceneState}>
          <OpenClawChatThread sceneState={sceneState} />
        </DiscordWorkspaceFrame>
      </Sequence>
    </AbsoluteFill>
  );
};
