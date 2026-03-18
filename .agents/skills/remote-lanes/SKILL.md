---
name: runner-remote-lanes-specialist
description: Specialized guidance for using Runner Remote Lanes in applications. Use when Codex needs to choose between Event Lanes and RPC Lanes, design lane topology with profiles and bindings, configure transport modes (`network`, `transparent`, `local-simulated`), wire HTTP exposure or communicator resources, debug lane auth or serializer-boundary issues, or test distributed routing with Runner Remote Lanes.
---

# Runner Remote Lanes Specialist

Use this skill for application-level Remote Lanes work.
This is about building with Remote Lanes, not changing Runner internals.

## Start Here

Read in this order:

- `./references/REMOTE_LANES.md` for the main guide and canonical examples.
- `./references/REMOTE_LANES_AI.md` for the compact AI field guide when you need a faster refresher.
- `../../../readmes/REMOTE_LANES_HTTP_POLICY.md` only when the task is specifically about HTTP transport policy.

Treat Remote Lanes as a routing layer that should preserve your domain definitions.
Tasks and events stay normal Runner definitions; topology decides where they run.

## Choose The Right Lane Model

Make the first decision explicit:

- Use Event Lanes for async fire-and-forget event propagation.
- Use RPC Lanes for synchronous task or event RPC.
- Use both only when the architecture genuinely needs request/response plus downstream propagation.

If the user is undecided, recommend:

- Event Lanes for decoupled propagation and queue semantics.
- RPC Lanes for request/response behavior with remote results.

## Build The Topology Deliberately

Design Remote Lanes from three moving parts:

- `lane`: the named routing boundary
- `profile`: which runtime role is active in this process
- `binding`: which queue or communicator backs that lane

When implementing or reviewing a lane setup:

1. Identify which tasks or events should be lane-assigned.
2. Choose Event Lanes or RPC Lanes.
3. Define lanes first.
4. Define topology with explicit `profiles` and `bindings`.
5. Register the correct Node resource:
   - `eventLanesResource`
   - `rpcLanesResource`
6. Choose the right mode:
   - `network` for real transport
   - `transparent` for fastest local smoke tests
   - `local-simulated` for serializer-boundary and auth-path simulation

Prefer explicit lane assignment via lane builders or Runner tags.

## Keep Boundaries Honest

Remote Lanes are Node-only on the server side.

- Import server resources from `@bluelibs/runner/node`.
- Keep domain logic outside lane transport config.
- Use topology to decide where work runs, not whether the business action should exist.
- Keep hook/task business rules in application code, not in routing assumptions.
- Remember that auth for HTTP exposure and auth for lane execution are separate concerns.

For RPC Lanes:

- Distinguish `exposure.http.auth` from lane `binding.auth`.
- Ensure every served or assigned lane has a communicator binding.

For Event Lanes:

- Model queue ownership and retry policy intentionally.
- Keep in mind that dead-letter behavior belongs to queue or broker policy.

## Local Development And Testing

Use the lightest mode that proves the contract:

- `transparent` when you only need call-site shape and local behavior.
- `local-simulated` when you need serialization, async-context filtering, or auth-path simulation.
- `network` when you need real integration with queues or remote communicators.

In tests:

- Start with the smallest app/resource graph that expresses the lane contract.
- Assert through emitted events, task results, queue effects, or exposure behavior.
- Add focused tests for auth readiness, missing bindings, and mode-specific behavior when those are part of the task.

## Debugging Heuristics

When Remote Lanes misbehave, check these first:

- wrong lane type chosen for the use case
- lane not assigned at all
- profile does not `consume` or `serve` the target lane
- missing queue or communicator binding
- missing signer or verifier material
- `transparent` or `local-simulated` mode hiding a network-only expectation
- serializer boundary mismatch or async-context policy mismatch

If the problem mentions HTTP transport details, multipart uploads, or exposure policy, read `../../../readmes/REMOTE_LANES_HTTP_POLICY.md` before changing code.

## Finish Cleanly

Before finishing:

- confirm the lane choice still matches the latency and coupling model
- confirm topology is explicit and profile-driven
- confirm Node-only assumptions stay in Node surfaces
- run focused tests first, then `npm run qa`
