import { TransportProvider } from "@connectrpc/connect-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";

import { landingTransport } from "./lib/connect-client";
import { createQueryClient } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";

const queryClient = createQueryClient();

const router = createRouter({
  context: { queryClient },
  routeTree,
});

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
