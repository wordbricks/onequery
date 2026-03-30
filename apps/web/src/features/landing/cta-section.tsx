import { buttonVariants } from "@onequery/ui/components/button";
import { cn } from "@onequery/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import { SIGNIN_ROUTE } from "@/lib/app-routes";

export function CtaSection() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="flex flex-col items-center text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Get started in minutes
          </h2>
          <p className="mt-4 max-w-lg text-muted-foreground">
            Self-host for free with a single command, or try the managed cloud
            version.
          </p>
          <Link
            to={SIGNIN_ROUTE}
            className={cn(buttonVariants({ size: "lg" }), "mt-8 px-8")}
          >
            Start Free
          </Link>
        </div>
      </div>
    </section>
  );
}
