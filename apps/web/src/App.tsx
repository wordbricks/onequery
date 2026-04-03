import { createRouter, RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";

import { RouteErrorComponent } from "@/components/route-error-component";
import { useSession } from "@/lib/auth-client";
import { createRouterAuth, defaultRouterAuth } from "@/lib/route-auth";
import { Providers, queryClient } from "@/providers";

import { routeTree } from "./routeTree.gen";

const router = createRouter({
  context: {
    auth: defaultRouterAuth,
    queryClient,
    refetchSession: async () => {},
  },
  defaultErrorComponent: RouteErrorComponent,
  defaultPreload: "intent",
  defaultPreloadDelay: 50,
  defaultPreloadStaleTime: 0,
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function AppBootstrapFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-muted-foreground" />
    </div>
  );
}

function RoutedApp() {
  const { data: session, isPending, refetch } = useSession();
  const auth = createRouterAuth(session);
  const refetchSession = async () => {
    await refetch();
  };

  useEffect(() => {
    void router.invalidate();
  }, [auth.isAuthenticated, auth.session?.user.id, isPending]);

  if (isPending) {
    // Comment: `beforeLoad` guards need a settled auth snapshot. Holding the
    // first router render avoids redirecting protected routes off a still-pending
    // Better Auth session check.
    return <AppBootstrapFallback />;
  }

  return (
    <RouterProvider
      router={router}
      context={{
        auth,
        queryClient,
        refetchSession,
      }}
    />
  );
}

export default function App() {
  return (
    <Providers>
      <RoutedApp />
    </Providers>
  );
}
