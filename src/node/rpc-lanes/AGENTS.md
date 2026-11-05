# RPC Lane Runtime

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Responsibility

Runtime routing of tasks/events across declared RPC lanes, with profile serving,
communicator bindings, auth, async-context transfer, and optional HTTP exposure.
This layer wires runtime-owned definitions; it does not own generic task execution.

## Start Here

- [rpcLanes.resource.ts](rpcLanes.resource.ts): dependencies, init, cooldown/dispose.
- [RpcLanesInternals.ts](RpcLanesInternals.ts): resolved state, profiles/bindings,
  exposure policy snapshots, and resource value.
- [RpcLaneAssignments.ts](RpcLaneAssignments.ts): applyTo and cross-lane conflicts.
- [rpcLanes.runtime.utils.ts](rpcLanes.runtime.utils.ts): mode dispatch/ownership.
- [rpcLanes.network.ts](rpcLanes.network.ts): remote task replacement/event interception.
- [rpcLanes.local-simulated.ts](rpcLanes.local-simulated.ts): serializer/context boundary.
- [rpcLanes.auth.ts](rpcLanes.auth.ts) and [rpcLanes.exposure.ts](rpcLanes.exposure.ts):
  request authorization and exposure startup.
- [registerRpcLaneHttpPresets.ts](registerRpcLaneHttpPresets.ts): Node HTTP presets.

## Contracts To Preserve

- `network` routes non-served targets remotely; served targets execute locally.
  `transparent` bypasses transport, while `local-simulated` exercises serialization
  and isolated async scopes without initializing network infrastructure.
- Task/event assignment maps use canonical ids. Mark routed task ownership with
  the canonical RPC resource id; two routing resources cannot own the same task.
- A target event cannot simultaneously belong to RPC and event lanes.
- Require communicator methods for the operation used. Preserve optional
  `eventWithResult`, returned event payloads, and caller cancellation.
- Retry wrappers are per resolved binding and preserve communicator receivers.
  Default execution is one attempt. Raw streams and Node-file uploads retain the overall call budget but make one attempt because their sources are consumed.
- JSON auth hashes exact serialized request bodies and forwarded context headers.
  Re-encoded multipart/octet-stream bodies use the matching empty-body convention.
- Exposure uses a resolved serving policy, canonical endpoint ids, and the runtime's
  serializer/context registry. Close it through the resource lifecycle.

## Tests And Further Reading

- [RPC lane tests](../__tests__/rpc-lanes): profiles/modes, assignments, overrides,
  auth, context transfer, exposure, retry, and ownership failures.
- [Mode tests](../__tests__/rpc-lanes/rpcLanes.modes.integration.test.ts) and
  [retry tests](../__tests__/rpc-lanes/rpcLanes.retry.integration.test.ts).
- [Remote Lanes guide](../../../readmes/REMOTE_LANES.md).
