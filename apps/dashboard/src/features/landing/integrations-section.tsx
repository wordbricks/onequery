const integrations = [
  "PostgreSQL",
  "MySQL",
  "BigQuery",
  "Google Analytics",
  "Amplitude",
  "Mixpanel",
  "PostHog",
  "Microsoft Clarity",
  "GitHub",
  "Vercel",
  "Cloudflare Web Analytics",
  "Linear",
];

export function IntegrationsSection() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Connect your stack
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            OneQuery integrates with the tools you already use.
          </p>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-4 sm:mt-12 sm:gap-x-8">
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
