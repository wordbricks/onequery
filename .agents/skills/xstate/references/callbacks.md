# Callbacks

Callback actors connect imperative sources to a machine.

## Shape

Use `fromCallback` for APIs that call back repeatedly and need cleanup.

```ts
import { fromCallback } from "xstate";

const ticks = fromCallback(({ input, sendBack, receive }) => {
  const intervalId = setInterval(() => {
    sendBack({ type: "timer.tick" });
  }, input.intervalMs);

  receive((event) => {
    if (event.type === "timer.reset") {
      sendBack({ type: "timer.resetAcknowledged" });
    }
  });

  return () => {
    clearInterval(intervalId);
  };
});
```

Use:

- `sendBack` for events sent to the parent
- `receive` for events sent from the parent to the callback actor
- returned cleanup for unsubscribe, remove listener, close socket, or clear timer

## Parent Contract

Model callback messages as normal parent events. Handle them with transitions, guards, and actions.

Use callback actors for long-running integration. Use promise actors for one request and one result.
