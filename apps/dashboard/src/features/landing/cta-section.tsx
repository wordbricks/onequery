import { buttonVariants } from "@onequery/ui/components/button";
import { cn } from "@onequery/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import { SIGNIN_ROUTE } from "@/lib/app-routes";

export function CtaSection() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="flex flex-col items-center text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Get started in minutes
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground sm:text-base">
            Self-host for free with a single command, or try the managed cloud
            version.
          </p>
          <Link
            to={SIGNIN_ROUTE}
            className={cn(buttonVariants({ size: "lg" }), "mt-7 px-8 sm:mt-8")}
          >
            Start Free
          </Link>
        </div>
      </div>
    </section>
  );
}
