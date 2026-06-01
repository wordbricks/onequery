import { useMountEffect } from "@onequery/ui/hooks/use-mount-effect";
import { useCallback, useRef } from "react";
import type { RefObject } from "react";

export type TextSwapController = {
  currentTextRef: { current: string };
  swapText: (nextText: string) => void;
  textRef: RefObject<HTMLElement | null>;
};

function readRootCssTimeMs(propertyName: string, fallbackMs: number) {
  if (typeof document === "undefined") {
    return fallbackMs;
  }

  const rawValue = getComputedStyle(document.documentElement)
    .getPropertyValue(propertyName)
    .trim();
  const parsedValue = parseFloat(rawValue);

  if (!Number.isFinite(parsedValue)) {
    return fallbackMs;
  }

  return rawValue.endsWith("s") && !rawValue.endsWith("ms")
    ? parsedValue * 1000
    : parsedValue;
}

export function useTextSwapController(initialText: string): TextSwapController {
  const currentTextRef = useRef(initialText);
  const targetTextRef = useRef(initialText);
  const textRef = useRef<HTMLElement | null>(null);
  const swapTimerRef = useRef<number | null>(null);

  const clearSwapTimer = useCallback(() => {
    if (swapTimerRef.current === null) {
      return;
    }

    window.clearTimeout(swapTimerRef.current);
    swapTimerRef.current = null;
  }, []);

  const swapText = useCallback(
    (nextText: string) => {
      clearSwapTimer();
      targetTextRef.current = nextText;

      const element = textRef.current;
      if (!element) {
        currentTextRef.current = nextText;
        return;
      }

      element.classList.remove("is-exit", "is-enter-start");

      if (currentTextRef.current === nextText) {
        element.textContent = nextText;
        return;
      }

      element.classList.add("is-exit");
      swapTimerRef.current = window.setTimeout(
        () => {
          currentTextRef.current = targetTextRef.current;
          element.textContent = targetTextRef.current;
          element.classList.remove("is-exit");
          element.classList.add("is-enter-start");
          void element.offsetHeight;
          element.classList.remove("is-enter-start");
          swapTimerRef.current = null;
        },
        readRootCssTimeMs("--text-swap-dur", 150)
      );
    },
    [clearSwapTimer]
  );

  useMountEffect(() => clearSwapTimer);

  return {
    currentTextRef,
    swapText,
    textRef,
  };
}

export { readRootCssTimeMs };
