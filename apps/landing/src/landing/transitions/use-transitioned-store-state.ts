import { useMountEffect } from "@onequery/ui/hooks/use-mount-effect";
import { startTransition, useState } from "react";

type TransitionedStore<T> = {
  get: () => T;
  listen: (listener: (state: T) => void) => () => void;
};

export function useTransitionedStoreState<T>(
  store: TransitionedStore<T>,
  onChange?: (state: T) => void
) {
  const [state, setState] = useState(() => store.get());

  useMountEffect(() =>
    store.listen((nextState) => {
      startTransition(() => {
        setState(nextState);
        onChange?.(nextState);
      });
    })
  );

  return state;
}
