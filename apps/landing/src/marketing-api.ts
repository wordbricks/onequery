import type { ContactFormInput, ProductUpdatesFormInput } from "./lead-capture";

function getMarketingApiBaseUrl() {
  return import.meta.env.VITE_LANDING_API_BASE_URL?.trim() ?? "";
}

function buildMarketingApiUrl(pathname: string) {
  const baseUrl = getMarketingApiBaseUrl();
  if (!baseUrl) {
    return pathname;
  }

  return new URL(pathname, baseUrl).toString();
}

async function postJson(pathname: string, body: object) {
  const response = await fetch(buildMarketingApiUrl(pathname), {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : "Request failed";
    throw new Error(message);
  }
}

export function submitProductUpdates(input: ProductUpdatesFormInput) {
  return postJson("/api/product-updates", input);
}

export function submitContactForm(input: ContactFormInput) {
  return postJson("/api/contact", input);
}
