export function listSourceApiJsonPaths(value: unknown): string[] {
  const paths = new Set<string>();
  collectSourceApiJsonPaths(value, undefined, paths);
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function collectSourceApiJsonPaths(
  value: unknown,
  currentPath: string | undefined,
  paths: Set<string>
): void {
  if (Array.isArray(value)) {
    if (!currentPath) {
      return;
    }

    paths.add(`${currentPath}[]`);
    return;
  }

  if (!isPlainRecord(value)) {
    if (currentPath) {
      paths.add(currentPath);
    }
    return;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [key, child] of entries) {
    const childPath = currentPath ? `${currentPath}[${key}]` : key;
    paths.add(childPath);
    collectSourceApiJsonPaths(child, childPath, paths);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
