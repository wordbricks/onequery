import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      {/* Comment: keep the public landing SEO/share tags in Vite's index.html
      until this app moves to SSR or prerendering. In a client-only SPA, route
      head tags only appear after hydration. */}
      <HeadContent />
      <Outlet />
      <Scripts />
    </>
  );
}
