import { IconGitCompare, IconRefresh, IconRobot } from "@tabler/icons-react";
import type { ComponentType } from "react";

interface Feature {
  icon: ComponentType<{ size?: number; stroke?: number; className?: string }>;
  title: string;
  description: string;
}

const features: Feature[] = [
  {
    description:
      "Connect databases, analytics tools, and connectors without stitching together a custom control plane.",
    icon: IconRobot,
    title: "Unified Access",
  },
  {
    description:
      "Run consistent workflows across databases, analytics, GitHub, and more from the same workspace.",
    icon: IconGitCompare,
    title: "Cross-Source Coverage",
  },
  {
    description:
      "Manage data source connectivity, budgets, and team access from a single operational surface.",
    icon: IconRefresh,
    title: "Operational Control",
  },
];

export function FeaturesSection() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            One workspace for connected data
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Replace scattered setup steps with a single, consistent control
            plane.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:mt-16 sm:gap-8 md:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="flex flex-col rounded-lg border border-border p-5 sm:p-6"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                <feature.icon size={20} stroke={1.5} className="size-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
