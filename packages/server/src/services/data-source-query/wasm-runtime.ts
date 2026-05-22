export const isCloudflareWorkers =
  typeof navigator !== "undefined" &&
  navigator.userAgent === "Cloudflare-Workers";

export const isNodeLike = typeof process === "object" && process !== null;
