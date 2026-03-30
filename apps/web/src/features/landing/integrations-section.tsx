const integrations = [
  "PostgreSQL",
  "MySQL",
  "BigQuery",
  "Google Analytics",
  "Amplitude",
  "Mixpanel",
  "PostHog",
  "GitHub",
  "Linear",
];

export function IntegrationsSection() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Connect your stack
          </h2>
          <p className="mt-4 text-muted-foreground">
            OneQuery integrates with the tools you already use.
          </p>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          {integrations.map((name) => (
            <div
              key={name}
              className="text-sm font-medium text-muted-foreground"
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
