function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function normalizeBigQueryAccessToken(accessToken: string): string {
  const normalized = accessToken.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    throw new Error("BigQuery access token is required.");
  }
  return normalized;
}

export function normalizeBigQueryProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    hasControlCharacters(normalized) ||
    !/^[A-Za-z0-9:_-]+$/u.test(normalized)
  ) {
    throw new Error("BigQuery project ID is invalid.");
  }
  return normalized;
}

export function normalizeBigQueryPath(path: string): string {
  const normalized = path.trim();
  if (
    normalized.length === 0 ||
    !normalized.startsWith("/") ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    hasControlCharacters(normalized)
  ) {
    throw new Error("BigQuery API path is invalid.");
  }

  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("BigQuery API path is invalid.");
  }

  return normalized;
}

export function normalizeBigQueryQueryPart(
  value: string,
  label: string
): string {
  const normalized = value.trim();
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    throw new Error(`BigQuery ${label} is invalid.`);
  }
  return normalized;
}
