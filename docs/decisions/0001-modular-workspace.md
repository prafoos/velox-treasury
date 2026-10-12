# ADR 0001: Modular workspace boundary

## Status

Accepted for Step 1.

## Decision

Velox Treasury uses a pnpm workspace with separate browser (`apps/web`) and
private-service (`apps/api`) boundaries. Shared domain types and validation
schemas live in `packages/domain` and `packages/validation`.

The web application is organized by feature. `app` owns only providers,
routing, and layout; individual features own their UI, hooks, and
browser-safe services.

The API boundary is reserved for future AI orchestration, policy validation,
automation, and audit logging. An agent may propose an action, but policy
validation remains independent from the agent and precedes any future
execution path.

Future swap providers are accessed through the swap feature's adapter layer.
The feature may request normalized quotes and transaction preparation, while
the treasury domain remains independent of routing and liquidity-provider
details. This design does not create or require proprietary liquidity.

## Consequences

No chain, token, contract, RPC, swap, earn, or AI-provider configuration is
present in Step 1. Such details require official verification in their
respective implementation steps.

