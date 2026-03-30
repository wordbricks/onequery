import { getBrowserOrigin } from "@/lib/browser-origin";

/**
 * Returns the API base URL for the current browser session.
 *
 * @returns The API base URL to use for requests
 */
export function getApiBaseUrl(): string {
  return getBrowserOrigin();
}
