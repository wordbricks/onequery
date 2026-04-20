import { TransportProvider } from "@connectrpc/connect-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
import { landingTransport } from "./runtime/connect-transport";
import { createQueryClient } from "./runtime/query-client";
import { registerRouterPageViewTracking } from "./runtime/router-page-view-tracking";

const queryClient = createQueryClient();

const router = createRouter({
  context: { queryClient },
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
  return (
    <TransportProvider transport={landingTransport}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </TransportProvider>
  );
}
