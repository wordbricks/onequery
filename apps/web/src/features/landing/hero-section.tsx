import { buttonVariants } from "@onequery/ui/components/button";
import { cn } from "@onequery/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import { SIGNIN_ROUTE } from "@/lib/app-routes";

export function HeroSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 md:py-32">
      <div className="flex flex-col items-center text-center">
        <h1 className="max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          Your autonomous data workspace
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          Connect your data sources, query them from one place, and keep your
          team aligned on the systems that matter. OneQuery gives you a clean
          control plane for operating your data access.
        </p>
        <Link
          to={SIGNIN_ROUTE}
          className={cn(buttonVariants({ size: "lg" }), "mt-10 px-8")}
        >
          Get Started
        </Link>
      </div>
    </section>
  );
}
