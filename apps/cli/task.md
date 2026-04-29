# Gateway Supervisor Follow-Up Tasks

Patch these one by one.

1. [x] Remove unused direct gateway dependencies.
   - Check whether `futures` and `http-body` are unnecessary in `crates/gateway/Cargo.toml`.
   - Keep them where generated proto/connect crates need them.
   - Verify with `cargo check -p onequery-gateway`.

2. [x] Move runtime-control client defaults into `ClientConfig`.
   - Put shared timeout, max message size, and static headers on `connectrpc::client::ClientConfig`.
   - Keep dynamic headers like request id, launch id, and supervisor id in `CallOptions`.
   - Keep generated client and `Http2Connection::connect_unix(...).shared(...)`.

3. Decide how lifecycle event-log recovery should work.
   - Current recovery writes lifecycle event frames but does not fold them during recovery.
   - Either implement event-log recovery folding or document snapshots as the recovery source of truth.

4. Make supervisor generation durable.
   - Replace the fixed `SUPERVISOR_GENERATION = 1` with persisted/allotted generation if supervisor fencing needs to survive restarts.
   - Keep target fencing aligned with RuntimeControl `RuntimeTarget`.

5. Split large runtime modules before adding more behavior.
   - Avoid growing `supervisor.rs`, `supervisor_effects.rs`, and `lifecycle.rs`.
   - Prefer focused modules for startup handshake, monitor loop, lifecycle event writing, and recovery folding.
