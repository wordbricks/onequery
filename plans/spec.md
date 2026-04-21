# Audit V2 Specification

This directory is the normative specification for Audit V2. The standard is operational: two engineers implementing from these documents should converge on the same state machines, storage guarantees, and feed semantics.

These files define required behavior and invariants. They are not implementation notes and they are not a place for pseudo-code.

## Document Ownership

- [plan.md](./plan.md) defines the target system, scope boundaries, replacement discipline, and delivery order.
- [shared-kernel.md](./shared-kernel.md) defines the workflow contract shared by every family: commands, decisions, reducers, rejects, effects, and lifecycle axes.
- [storage-contract.md](./storage-contract.md) defines durable write-side behavior: idempotency, append rules, folding, outbox emission, replay, and recovery.
- [query-family.md](./query-family.md) defines the `query_action` state machine.
- [source-api-family.md](./source-api-family.md) defines the `source_api_action` state machine.
- [projection-and-api.md](./projection-and-api.md) defines the rebuildable read model and the public feed contract.

## Precedence

When documents overlap, higher-level documents win:

1. [plan.md](./plan.md)
2. [shared-kernel.md](./shared-kernel.md)
3. [storage-contract.md](./storage-contract.md)
4. [query-family.md](./query-family.md) and [source-api-family.md](./source-api-family.md)
5. [projection-and-api.md](./projection-and-api.md)

A lower-layer document may refine a higher-layer rule inside its own scope. It may not weaken or contradict it.
