import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";

export const Route = createRootRoute({
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
