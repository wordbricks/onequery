import type { APIRoute } from "astro";

import { handleProductUpdatesRequest } from "@/server/api";
import { readWorkerBindings } from "@/server/bindings";

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  handleProductUpdatesRequest({
    bindings: readWorkerBindings(),
    request,
  });
