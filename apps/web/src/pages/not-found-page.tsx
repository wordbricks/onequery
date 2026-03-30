import { buttonVariants } from "@onequery/ui/components/button";
import { Link } from "@tanstack/react-router";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-6xl font-bold">404</h1>
      <p className="mt-4 text-xl text-muted-foreground">Page not found</p>
      <Link to="/" className={buttonVariants({ className: "mt-8" })}>
        Go Home
      </Link>
    </div>
  );
}
