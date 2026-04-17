import React from "react";
import { interpolate } from "remotion";

import type { CommandModel } from "./model";
import { surfaces } from "./theme";

const renderTypedSegments = (
  segments: readonly { text: string; color: string }[],
  visibleChars: number
) => {
  let remaining = visibleChars;
  let offset = 0;

  return segments.map((segment) => {
    if (remaining <= 0) {
      return null;
    }

    const visible = Math.min(segment.text.length, remaining);
    remaining -= segment.text.length;

    const key = `${offset}:${segment.color}`;
    offset += segment.text.length;

    return (
      <span key={key} style={{ color: segment.color }}>
        {segment.text.slice(0, visible)}
      </span>
    );
  });
};

export const Cursor: React.FC<{ frame: number; visible: boolean }> = ({
  frame,
  visible,
}) => {
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
        color: surfaces.terminalText,
        opacity,
      }}
    >
      {"\u258C"}
    </span>
  );
};

export const TypedCommandLine: React.FC<{
  frame: number;
  command: CommandModel;
}> = ({ frame, command }) => (
  <div style={{ display: "flex", gap: 10 }}>
    <span style={{ color: surfaces.terminalPrompt }}>$</span>
    <code
      style={{
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {renderTypedSegments(command.segments, command.typedChars)}
      <Cursor frame={frame} visible={command.status === "typing"} />
    </code>
  </div>
);

export const Avatar: React.FC<{
  label: string;
  background: string;
  color: string;
  size?: number;
}> = ({ label, background, color, size = 40 }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "none",
      width: size,
      height: size,
      borderRadius: size / 2,
      background,
      color,
      fontSize: size * 0.38,
      fontWeight: 700,
      letterSpacing: "-0.04em",
    }}
  >
    {label}
  </div>
);

export const Pill: React.FC<{
  text: string;
  background: string;
  color: string;
  weight?: number;
}> = ({ text, background, color, weight = 600 }) => (
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
      fontWeight: weight,
      letterSpacing: "0.01em",
      lineHeight: 1,
    }}
  >
    {text}
  </span>
);

export const SectionLabel: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      color: surfaces.textSoft,
      fontSize: 10.5,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}
  >
    {text}
  </div>
);

export const Bar: React.FC<{ percent: number }> = ({ percent }) => (
  <div
    style={{
      width: "100%",
      height: 6,
      borderRadius: 3,
      background: surfaces.barTrack,
      overflow: "hidden",
    }}
  >
    <div
      style={{
        width: `${percent}%`,
        height: "100%",
        background: surfaces.ink,
        borderRadius: 3,
      }}
    />
  </div>
);
