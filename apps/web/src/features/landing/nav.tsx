import { buttonVariants } from "@onequery/ui/components/button";
import { cn } from "@onequery/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import { ThemeToggle } from "@/features/theme/theme-toggle";
import { ROOT_ROUTE, SIGNIN_ROUTE } from "@/lib/app-routes";

export function Nav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to={ROOT_ROUTE} className="flex items-center gap-2">
          <img src="/onequery.svg" alt="OneQuery" className="h-8 w-8" />
          <span className="font-semibold text-base sm:text-lg">OneQuery</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to={SIGNIN_ROUTE}
            className={cn(
              buttonVariants({ size: "sm", variant: "ghost" }),
              "hidden sm:inline-flex"
            )}
          >
            Sign in
          </Link>
          <Link
            to={SIGNIN_ROUTE}
            className={buttonVariants({ size: "sm", variant: "default" })}
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}
