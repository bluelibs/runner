# Node HTTP Clients

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Responsibility

Node clients for Runner HTTP exposure, adding stream/multipart support to the
portable fetch transport. Clients implement RPC communicator-compatible methods;
lane topology, retries, and serving policies are owned by sibling modules.

## Start Here

- [http-smart-client.model.ts](http-smart-client.model.ts): Node request transport,
  JSON/multipart/octet-stream requests, response streams, and typed error mapping.
- [http-mixed-client.ts](http-mixed-client.ts): task transport selection.
- [nodeFileDetection.ts](nodeFileDetection.ts): Node-readable/file detection.
- [http-smart-client.factory.resource.ts](http-smart-client.factory.resource.ts) and
  [http-mixed-client.factory.resource.ts](http-mixed-client.factory.resource.ts):
  factory placeholders wired by the Node runtime with serializer/contexts/errors.
- [index.ts](index.ts): exports; [portable fetch](../../http-fetch-remote-lane.resource.ts)
  owns the standard JSON path.
- [Node manifest](../upload/manifest.ts) supplies local upload sources;
  [exposure](../exposure/AGENTS.md) owns the receiving contract.

## Contracts To Preserve

- Mixed tasks select smart transport for Node Readable input, nested Node-file
  sentinels, or `forceSmart`; ordinary inputs use fetch. Events always use JSON.
  `forceSmart` enables stream responses even when task input is plain JSON.
- Node-file detection handles cyclic object graphs. Upload manifest traversal has
  its own contract; detecting a cyclic graph does not make multipart input replayable.
- Keep `_node` sources off the wire. Multipart manifests and their file parts must
  agree on sentinel ids/metadata; raw readable input uses octet-stream.
- Preserve auth/default headers, request hooks, selected async contexts, typed
  remote errors, and caller signals across all transport paths.
- Abort/timeout/source-error handling settles once and removes listeners. Streaming
  response lifetime differs from a buffered JSON response; avoid premature cleanup.
- HTTP status transport errors retain parsed Retry-After guidance for the portable retry wrapper.
- These clients do not decide lane retry policy. RPC routing limits execution to one attempt (with the overall budget) for
  stream/upload sources, which may already be consumed after the first request.

## Tests To Read

- [Node HTTP tests](../__tests__/http): transport selection, streams, multipart,
  status/network errors, timeouts, auth, hooks, context serialization, and cancellation.
- [Abort handling](../__tests__/http/http-smart-client.abort-signal.test.ts).
- [Detection](../__tests__/http/nodeFileDetection.unit.test.ts).
- [Upload manifests](../__tests__/upload/manifest.test.ts).
