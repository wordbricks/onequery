import type { APIRoute } from "astro";

import { handleContactRequest } from "@/server/api";
import { readWorkerBindings } from "@/server/bindings";

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  handleContactRequest({
    bindings: readWorkerBindings(),
    request,
  });
