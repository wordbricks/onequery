export function getBrowserOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}
