# Expected Report Shape

## Summary

Enterprise activation rate decreased in the last 7 days compared with the prior
7-day baseline. The strongest current hypothesis is a regression affecting one
signup channel or region, supported by the warehouse aggregate and correlated
operational signals.

## Evidence

| Source | Purpose | Request ID | Result |
|---|---|---|---|
| `warehouse` | Compare enterprise activation by day, plan, channel, and region | `hermes-...` | Activation dropped most in one segment |
| `sentry` | Check error spikes near activation flow | `hermes-...` | Error spike overlapped with drop window |
| `github` | Check deployments near drop start | `hermes-...` | Deployment candidate found |
| `linear` | Check incidents/regressions | `hermes-...` | Related ticket candidate found |

## Root-Cause Candidates

1. High confidence: activation flow regression in affected segment.
2. Medium confidence: tracking/instrumentation change causing apparent metric movement.
3. Low confidence: normal weekly seasonality, pending a longer baseline query.

## Gaps

- No raw user rows were queried.
- PII-like columns were excluded.
- Further analysis should run a bounded aggregate for a 28-day baseline.

