type CredentialPatchResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; detail: string };

export function mergeSourceCredentialPatch(
  current: Record<string, unknown>,
  patch: unknown
): CredentialPatchResult {
  if (!isNonEmptyRecord(patch)) {
    return {
      detail: "credentials must be a non-empty JSON object",
      ok: false,
    };
  }

  const currentType = current.type;
  if (
    typeof currentType === "string" &&
    patch.type !== undefined &&
    patch.type !== currentType
  ) {
    return {
      detail: `credentials.type must remain "${currentType}"`,
      ok: false,
    };
  }

  return {
    ok: true,
    value: {
      ...current,
      ...patch,
      ...(typeof currentType === "string" ? { type: currentType } : {}),
    },
  };
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}
