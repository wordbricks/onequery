import type { APIRoute } from "astro";

import { createInstallScriptResponse } from "../tooling/install-script";

export const prerender = false;

export const GET: APIRoute = ({ request }) =>
  createInstallScriptResponse(request);

export const HEAD: APIRoute = ({ request }) =>
  createInstallScriptResponse(request);
