export function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function sanitizeProviderErrorText(
  text: string,
  secret: string
): string {
  const normalizedSecret = secret.trim();
  const redacted =
    normalizedSecret.length === 0
      ? text
      : text.split(normalizedSecret).join("***");
  return redacted.trim().slice(0, 500);
}
