import { createRouter, RouterProvider } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
import { registerRouterPageViewTracking } from "./runtime/router-page-view-tracking";

const router = createRouter({
  routeTree,
});

const stopRouterPageViewTracking = registerRouterPageViewTracking(router);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopRouterPageViewTracking();
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return <RouterProvider router={router} />;
}
