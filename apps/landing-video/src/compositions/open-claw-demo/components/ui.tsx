import React from "react";
import { Img, interpolate, useCurrentFrame } from "remotion";

import type { CommandRenderState } from "../scene-state";
import { surfaceTokens } from "../tokens";

const renderVisibleCommandSegments = (
  segments: readonly { text: string; color: string }[],
  visibleCharacterCount: number
) => {
  let remainingCharacters = visibleCharacterCount;
  let currentOffset = 0;

  return segments.map((segment) => {
    if (remainingCharacters <= 0) {
      return null;
    }

    const visibleCharactersInSegment = Math.min(
      segment.text.length,
      remainingCharacters
    );
    remainingCharacters -= segment.text.length;

    const key = `${currentOffset}:${segment.color}`;
    currentOffset += segment.text.length;

    return (
      <span key={key} style={{ color: segment.color }}>
        {segment.text.slice(0, visibleCharactersInSegment)}
      </span>
    );
  });
};

const BlinkingCursor: React.FC<{ visible: boolean }> = ({ visible }) => {
  const frame = useCurrentFrame();

  if (!visible) {
    return null;
  }

  const opacity = interpolate(frame % 18, [0, 9, 18], [1, 0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <span
      style={{
        marginLeft: 2,
        color: surfaceTokens.terminalText,
        opacity,
      }}
    >
      {"\u258C"}
    </span>
  );
};

export const CommandLine: React.FC<{
  commandState: CommandRenderState;
}> = ({ commandState }) => (
  <div style={{ display: "flex", gap: 10 }}>
    <span style={{ color: surfaceTokens.terminalPrompt }}>$</span>
    <code
      style={{
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {renderVisibleCommandSegments(
        commandState.segments,
        commandState.visibleCharacterCount
      )}
      <BlinkingCursor visible={commandState.typingStatus === "typing"} />
    </code>
  </div>
);

export const AvatarBadge: React.FC<{
  label: string;
  background: string;
  color: string;
  imageInset?: number;
  imageSrc?: string;
  size?: number;
}> = ({ label, background, color, imageInset = 0, imageSrc, size = 40 }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      flex: "none",
      width: size,
      height: size,
      borderRadius: size / 2,
      background,
      overflow: "hidden",
      color,
      fontSize: size * 0.38,
      fontWeight: 700,
      letterSpacing: "-0.04em",
    }}
  >
    {imageSrc ? (
      <Img
        src={imageSrc}
        style={{
          position: "absolute",
          inset: imageInset,
          width: size - imageInset * 2,
          height: size - imageInset * 2,
          display: "block",
          objectFit: "cover",
        }}
      />
    ) : (
      label
    )}
  </div>
);

export const StatusPill: React.FC<{
  text: string;
  background: string;
  color: string;
  fontWeight?: number;
}> = ({ text, background, color, fontWeight = 600 }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      minHeight: 22,
      padding: "0 8px",
      borderRadius: 6,
      background,
      color,
      fontSize: 11,
      fontWeight,
      letterSpacing: "0.01em",
      lineHeight: 1,
    }}
  >
    {text}
  </span>
);

export const SectionEyebrow: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      color: surfaceTokens.textSoft,
      fontSize: 10.5,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}
  >
    {text}
  </div>
);

export const MetricBar: React.FC<{ percent: number }> = ({ percent }) => (
  <div
    style={{
      width: "100%",
      height: 6,
      borderRadius: 3,
      background: surfaceTokens.barTrack,
      overflow: "hidden",
    }}
  >
    <div
      style={{
        width: `${percent}%`,
        height: "100%",
        background: surfaceTokens.ink,
        borderRadius: 3,
      }}
    />
  </div>
);
