import { Toaster } from "@onequery/ui/components/sonner";
import { TooltipProvider } from "@onequery/ui/components/tooltip";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
} from "@tanstack/react-router";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { RouteErrorComponent } from "@/components/route-error-component";
import type { RouterAuthContext } from "@/lib/route-auth";
import { NotFoundPage } from "@/pages/not-found-page";

interface RouterContext {
  auth: RouterAuthContext;
  queryClient: QueryClient;
  refetchSession: () => Promise<void>;
}

function GlobalFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-muted-foreground" />
    </div>
  );
}

function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <HeadContent />
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </>
  );
}

function RootComponent() {
  return (
    <RootLayout>
      <Suspense fallback={<GlobalFallback />}>
        <Outlet />
      </Suspense>
    </RootLayout>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  errorComponent: (props) => (
    <RootLayout>
      <RouteErrorComponent {...props} />
    </RootLayout>
  ),
  notFoundComponent: NotFoundPage,
});
