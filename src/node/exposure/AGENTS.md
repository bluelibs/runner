# Node HTTP Exposure

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Responsibility

HTTP ingress for lane-served tasks/events: routing, authentication/authorization,
allowlists, body parsing, request context/cancellation, responses, and server lifetime.
Serving policy is supplied by RPC lanes; this directory applies that snapshot.

## Start Here

- [createNodeExposure.ts](createNodeExposure.ts): assemble handlers/server controls.
- [requestHandlers.ts](requestHandlers.ts), [router.ts](router.ts), and
  [handlers](handlers): dispatch, discovery, task/event execution, and error responses.
- [authenticator.ts](authenticator.ts), [allowList.ts](allowList.ts), and
  [policy.ts](policy.ts): ingress access contracts.
- [requestBody.ts](requestBody.ts) and [multipart.ts](multipart.ts): JSON limits,
  streamed manifests/files, hydration, and multipart finalization.
- [requestContext.ts](requestContext.ts), [requestIdentity.ts](requestIdentity.ts),
  and [utils.ts](utils.ts): request scope, audit ids, disconnect cancellation.
- [httpResponse.ts](httpResponse.ts) and [cors.ts](cors.ts): output and CORS policy.
- [exposureServer.ts](exposureServer.ts) and [serverLifecycle.ts](serverLifecycle.ts):
  owned server startup/shutdown and detachable listeners for external servers.

## Contracts To Preserve

- Authentication fails closed unless anonymous access is explicitly enabled.
  Empty/disabled serving policy denies task/event access even with valid auth.
- Resolve endpoint ids and source resource ids through Store lookup before policy
  checks/execution. Keep canonical definition ids distinct from request audit ids.
- Authentication, endpoint allowlist, and authorization precede task/event execution.
  Body authorization hashes exact received JSON bytes, not reserialized payloads.
  Multipart/raw streaming authorization uses the matching empty-body convention.
- Tasks support JSON, multipart, and raw octet streams. Raw requests remain readable
  via exposure context. Events use JSON/user contexts; they do not get task request context.
- Multipart parsing exposes input before upload completion; handlers must await
  `finalize` before reporting success, and propagate limits, missing files, and aborts.
- Disconnect signals reach execution/body readers. Avoid a second response after
  headers/end; generic internal failures must not expose stack traces/private messages.
- Returning final event payload is unsupported for parallel events.
- External server attachment returns a detacher; closing exposure detaches its own
  listeners and stops its owned listening server without closing an external server.

## Tests To Read

- [Exposure tests](../__tests__/exposure): core lifecycle, handlers, security,
  CORS, multipart, streaming, discovery, and resources.
- [Ingress security](../__tests__/exposure/handlers/requestHandlers.security.test.ts).
- [Canonical ids](../__tests__/exposure/handlers/taskHandler.canonical-id.unit.test.ts).
- [Multipart tests](../__tests__/exposure/multipart) cover hydration/finalization races.
