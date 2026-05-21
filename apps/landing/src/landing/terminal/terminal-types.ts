export type TerminalLine = {
  kind: "prompt" | "continuation" | "output";
  text: string;
};
