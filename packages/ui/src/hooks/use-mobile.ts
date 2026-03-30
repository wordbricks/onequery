import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function getMobileMediaQueryList(): MediaQueryList | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.matchMedia(MOBILE_MEDIA_QUERY);
}

function readMobileSnapshot(): boolean {
  return getMobileMediaQueryList()?.matches ?? false;
}

function subscribeToMobileChanges(onStoreChange: () => void): () => void {
  const mediaQueryList = getMobileMediaQueryList();
  if (mediaQueryList === null) {
    return () => {};
  }

  // Comment: some embedded/older browser runtimes still expose only the legacy
  // MediaQueryList listener API, so keep the fallback local to this hook.
  const handleChange = () => {
    onStoreChange();
  };

  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", handleChange);
    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }

  mediaQueryList.addListener(handleChange);
  return () => {
    mediaQueryList.removeListener(handleChange);
  };
}

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribeToMobileChanges,
    readMobileSnapshot,
    () => false
  );
}
