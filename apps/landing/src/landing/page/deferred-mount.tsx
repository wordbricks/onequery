import { useMountEffect } from "@onequery/ui/hooks/use-mount-effect";
import { useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

type UseNearViewportInput = {
  rootMargin: string;
};

type NearViewportState<TElement extends Element> = {
  isNearViewport: boolean;
  targetRef: RefObject<TElement | null>;
};

type ViewportDeferredMountProps = {
  children: ReactNode;
  className?: string;
  fallback?: ReactNode;
  rootMargin: string;
};

export function useNearViewport<TElement extends Element>({
  rootMargin,
}: UseNearViewportInput): NearViewportState<TElement> {
  const targetRef = useRef<TElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useMountEffect(() => {
    const target = targetRef.current;

    if (target === null || isNearViewport) {
      return;
    }

    if (!("IntersectionObserver" in window)) {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        setIsNearViewport(true);
        observer.disconnect();
      },
      { rootMargin }
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  });

  return {
    isNearViewport,
    targetRef,
  };
}

export function ViewportDeferredMount({
  children,
  className,
  fallback = null,
  rootMargin,
}: ViewportDeferredMountProps) {
  const { isNearViewport, targetRef } = useNearViewport<HTMLDivElement>({
    rootMargin,
  });

  return (
    <div
      ref={targetRef}
      className={className}
      data-mounted={isNearViewport ? "true" : "false"}
    >
      {isNearViewport ? children : fallback}
    </div>
  );
}
