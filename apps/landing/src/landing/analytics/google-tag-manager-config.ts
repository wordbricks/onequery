export const GOOGLE_TAG_MANAGER_CONTAINER = "gtm.js";
export const GOOGLE_TAG_MANAGER_DOMAIN = "https://www.googletagmanager.com";

export type GoogleTagManagerEnv = {
  readonly PUBLIC_GOOGLE_TAG_MANAGER_ID?: string;
};

export type GoogleTagManagerConfig = {
  readonly container: string;
  readonly domain: string;
  readonly id: string;
};

function readOptionalEnvValue(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

export function readGoogleTagManagerConfig(
  env: GoogleTagManagerEnv
): GoogleTagManagerConfig | null {
  const id = readOptionalEnvValue(env.PUBLIC_GOOGLE_TAG_MANAGER_ID);
  if (!id) {
    return null;
  }

  return {
    container: GOOGLE_TAG_MANAGER_CONTAINER,
    domain: GOOGLE_TAG_MANAGER_DOMAIN,
    id,
  };
}
