# Shared Node Lane Infrastructure

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Responsibility

Shared topology, assignment, dependency, async-context, and authentication
mechanics for RPC lanes and event lanes. Keep transport-specific routing in
`../rpc-lanes` and `../event-lanes`; keep portable wire helpers in `../../remote-lanes`.

## Start Here

- [topologyLanes.ts](topologyLanes.ts): collect lanes across bindings/profiles.
- [laneAssignmentUtils.ts](laneAssignmentUtils.ts): target resolution, predicate
  candidates, assignments, and cross-RPC/event conflict detection.
- [mode.ts](mode.ts), [configPatterns.ts](configPatterns.ts), and
  [resourceDependencies.ts](resourceDependencies.ts): shared modes/config/dependencies.
- [asyncContextAllowlist.ts](asyncContextAllowlist.ts): context selection,
  canonical registry ids, header creation, and hydration.
- [laneAuth.ts](laneAuth.ts): authentication facade; `laneAuth.*` separates
  policy, binding keys, JWT encoding/signatures, target hashes, and token claims.

## Contracts To Preserve

- Default mode is `network`. Non-network modes do not collect transport resources.
- Reusing the same lane object is valid; distinct lane objects with the same id
  fail topology collection. Assignment conflicts fail rather than silently winning.
- Resolve definition references through the Store contract. Assignment keys and
  cross-lane event checks use canonical definition ids; lane ids keep exact identity.
  Never normalize ids by stripping lineage or splitting punctuation.
- Explicit context lists override legacy context permission. No list normally means
  none; legacy `allowAsyncContext: true` allows all registered contexts.
- Context headers include canonical context ids; requested aliases can also be
  retained for compatibility. Hydration ignores malformed maps/individual values
  and runs only allowed registered contexts; preserve this boundary behavior.
- Tokens bind lane, capability, optional target kind/id and payload hash, issuance,
  and expiry. Enforce configured algorithms/keys and signer/verifier readiness.
- Tokens are reusable while valid; this module does not provide replay deduplication.

## Tests And Further Reading

- [Shared infrastructure tests](../__tests__/remote-lanes): topology identity,
  assignment lookups, context allowlists, dependencies, JWT claims, and key failures.
- [Context tests](../__tests__/remote-lanes/asyncContextAllowlist.unit.test.ts).
- [Token tests](../__tests__/remote-lanes/laneAuth.tokens.unit.test.ts).
- [Remote Lanes guide](../../../readmes/REMOTE_LANES.md).
