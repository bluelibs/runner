# Portable Remote Lane Protocol

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Responsibility

Transport-neutral RPC retry behavior and shared HTTP wire contracts.
Node topology, JWT authentication, queues, and HTTP exposure belong in `src/node`.

## Start Here

- [retry.ts](retry.ts): retry defaults, policy validation, classification,
  communicator wrapping.
- [rpcRetryCall.ts](rpcRetryCall.ts): overall call budgets and abortable retry delays.
- [http/postFetch.ts](http/postFetch.ts) / [http/requestSignal.ts](http/requestSignal.ts): shared buffered JSON/multipart HTTP lifecycle.
- [http/retryAfter.ts](http/retryAfter.ts): bounded server retry-delay parsing.
- [http/protocol.ts](http/protocol.ts): request envelopes, response envelopes,
  transport errors, rejection normalization, and envelope assertions.
- [http/types.ts](http/types.ts): fetch client/config contracts.
- [http/constants.ts](http/constants.ts): async-context header name.
- [Fetch transport](../http-fetch-remote-lane.resource.ts): portable client consumer.
- [Node RPC routing](../node/rpc-lanes/rpcLanes.network.ts): binding retries and
  replayability decisions at runtime.

## Contracts To Preserve

- `maxAttempts` includes the first call; the default is one attempt; repeating execution requires an explicit policy.
  Numeric attempts must be positive integers and numeric delays finite/nonnegative.
- Default retries require a `RemoteLaneTransportError` with a retryable code or
  supported HTTP status. Typed domain errors carrying `id`, caller cancellation,
  malformed responses, and ordinary server 500 responses are not default retries.
- The wrapper preserves implemented methods and their original communicator
  receiver. Do not invent `eventWithResult` on communicators lacking it.
- Optional `totalTimeoutMs` bounds call attempts plus delays; HTTP Retry-After supplies a minimum delay without extending that budget.
- Caller signals cancel retry delays and prevent another attempt after cancellation.
  Retried inputs must be replayable; Node routing restricts stream/uploads to one attempt while retaining the budget.
- Request rejection normalization preserves cancellation and typed error identity;
  otherwise it creates `NETWORK_ERROR` with the original cause.
- Events requesting a result send `returnPayload: true`. Preserve the difference
  between an acknowledged event and a server-returned final payload.

## Tests To Read

- [Portable remote-lane tests](../__tests__/remote-lanes): retry classification,
  communicator contracts, cancellation races, and HTTP protocol behavior.
- [Receiver/cancellation regressions](../__tests__/remote-lanes/rpc-retry-communicator.review.unit.test.ts).
- [Fetch tests](../__tests__/http) cover status, timeout, context, and network errors.
