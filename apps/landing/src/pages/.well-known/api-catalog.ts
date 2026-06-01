import type { APIRoute } from "astro";

// oxlint's type-aware resolver misses "@/..." imports inside hidden route directories.
import { createApiCatalogResponse } from "../../server/api-catalog";

export const prerender = false;

export const GET: APIRoute = ({ request }) => createApiCatalogResponse(request);

export const HEAD: APIRoute = ({ request }) =>
  createApiCatalogResponse(request);
