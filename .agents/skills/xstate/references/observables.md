# Observables

Observable actors connect stream libraries to an actor system.

## Snapshot Streams

Use `fromObservable` when each emission is the actor snapshot value.

```ts
import { fromObservable } from "xstate";

const countStream = fromObservable(() => count$);
```

Read the child actor snapshot with `useSelector`, parent actions, or actor subscriptions.

## Event Streams

Use `fromEventObservable` when each emission is an event for the parent.

```ts
import { fromEventObservable } from "xstate";

const socketEvents = fromEventObservable(() => socketMessages$);
```

Emit domain events from the observable: `message.received`, `connection.closed`, `sync.failed`.

## Lifecycle

Invoke observable actors from the state that owns the stream. State exit stops the subscription.

Use `onDone` for completed streams and `onError` for stream failures when those outcomes affect the parent workflow.
