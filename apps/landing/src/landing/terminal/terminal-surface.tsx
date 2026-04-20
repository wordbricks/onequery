export type TerminalLine = {
  kind: "prompt" | "continuation" | "output";
  text: string;
};

type TerminalSurfaceProps = {
  footer: string;
  lines: readonly TerminalLine[];
  title: string;
};

export function TerminalSurface({
  footer,
  lines,
  title,
}: TerminalSurfaceProps) {
  return (
    <div className="terminal-surface" role="img" aria-label={title}>
      <div className="terminal-surface-toolbar">
        <div className="terminal-surface-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="terminal-surface-title">{title}</span>
      </div>

      <div className="terminal-surface-body">
        {lines.map((line) => (
          <div
            key={`${line.kind}-${line.text}`}
            className={`terminal-line terminal-line-${line.kind}`}
          >
            {line.kind === "output" ? null : (
              <span className="terminal-line-prefix" aria-hidden="true">
                {line.kind === "prompt" ? "$" : ">"}
              </span>
            )}
            <code>{line.text}</code>
          </div>
        ))}
      </div>

      <div className="terminal-surface-footer">
        <span>{footer}</span>
      </div>
    </div>
  );
}
