import React from "react";

const summaryCardShellStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 920,
  display: "grid",
  gap: 8,
  padding: 10,
  borderRadius: 14,
  background: "#ffffff",
  border: "1px solid rgba(0, 0, 0, 0.10)",
  transformOrigin: "top left",
};

type SummaryCardShellProps = {
  children: React.ReactNode;
  entryStyle: React.CSSProperties;
  scale: number;
  shadow: string;
};

export const SummaryCardShell: React.FC<SummaryCardShellProps> = ({
  children,
  entryStyle,
  scale,
  shadow,
}) => (
  <div
    style={{
      ...summaryCardShellStyle,
      ...entryStyle,
      boxShadow: shadow,
      transform: `${entryStyle.transform ?? ""} scale(${scale})`,
    }}
  >
    {children}
  </div>
);
