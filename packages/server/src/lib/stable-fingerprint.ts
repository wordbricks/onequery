import { createHash } from "node:crypto";

export function createStableValueFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("base64url");
}

function stableStringify(value: unknown): string {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value instanceof Uint8Array) {
    return `[${Array.from(value).join(",")}]`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right)
    );

    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${stableStringify(entryValue)}`
      )
      .join(",")}}`;
  }

  return JSON.stringify(String(value));
}
