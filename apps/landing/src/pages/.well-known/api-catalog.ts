import type { APIRoute } from "astro";

import { createApiCatalogResponse } from "../../server/api-catalog";

export const prerender = false;

export const GET: APIRoute = ({ request }) => createApiCatalogResponse(request);

export const HEAD: APIRoute = ({ request }) =>
  createApiCatalogResponse(request);
