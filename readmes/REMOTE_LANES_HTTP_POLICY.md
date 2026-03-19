# Runner Remote Lanes HTTP Protocol Policy (v1.0)

> **Status**: Draft reference derived from Runner implementation. This document formalizes the wire protocol used by HTTP RPC communicators and clients, enabling interoperability, debugging, and future extensions. It is not a normative standard but reflects the current behavior of RPC-lanes-owned HTTP exposure (`rpcLanesResource.with({ exposure: { http: ... } })`) and clients such as `createHttpClient`, `createHttpSmartClient`, and `createHttpMixedClient`. For usage, see [REMOTE_LANES.md](REMOTE_LANES.md).

> **Boundary**: This protocol is intended for inter-runner/service-to-service communication, not as a public web API contract for untrusted internet clients.

> **Mode Note**: This policy applies to Remote Lanes in `mode: "network"`. `transparent` and `local-simulated` are local runtime modes and do not define additional HTTP wire behavior.

## Table of Contents

- [Runner Remote Lanes HTTP Protocol Policy (v1.0)](#runner-remote-lanes-http-protocol-policy-v10)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
    - [Goals](#goals)
    - [Base Path](#base-path)
    - [Protocol Envelope](#protocol-envelope)
  - [Common Elements](#common-elements)
    - [Serialization](#serialization)
    - [Authentication](#authentication)
    - [Header Reference](#header-reference)
    - [Error Handling](#error-handling)
    - [CORS](#cors)
  - [Endpoints](#endpoints)
    - [Task Invocation (`POST /task/{taskId}`)](#task-invocation-post-tasktaskid)
    - [Event Emission (`POST /event/{eventId}`)](#event-emission-post-eventeventid)
    - [Discovery (`GET /discovery`)](#discovery-get-discovery)
  - [Request Modes](#request-modes)
    - [JSON Mode](#json-mode)
    - [Multipart Mode](#multipart-mode)
    - [Octet-Stream Mode](#octet-stream-mode)
  - [Response Modes](#response-modes)
  - [Extensions](#extensions)
    - [Abort and Timeouts](#abort-and-timeouts)
    - [Compression](#compression)
    - [Context Propagation (Node-Only)](#context-propagation-node-only)
    - [Streaming](#streaming)
  - [Examples](#examples)
    - [JSON Task (curl)](#json-task-curl)
    - [Multipart Upload (Node-like, conceptual curl)](#multipart-upload-node-like-conceptual-curl)
    - [Octet Duplex (Node-only, conceptual)](#octet-duplex-node-only-conceptual)
    - [Event Emission](#event-emission)
  - [References](#references)

## Overview

The Runner remote lanes HTTP protocol enables remote invocation of tasks and RPC-style event emission across processes (e.g., Node server to browser or CLI) using standard HTTP. It is stateless, extensible, and optimized for Runner's dependency injection, middleware, and validation model.

### Goals

- **Simplicity**: Minimal overhead; leverages HTTP/1.1+ with serialized JSON for structured data.
- **Cross-Platform**: Works in Node (streams/files) and browsers (fetch/FormData).
- **Security**: Auth (fail-closed by default), allow-lists, CORS, abort handling.
- **Efficiency**: Supports streaming (duplex/raw) and files (manifest-based multipart) without buffering.
- **Observability**: Logs, context propagation, discovery endpoint.

### Base Path

All endpoints are under a configurable base path (default: `/__runner`). Example: `http://localhost:7070/__runner/task/app.tasks.add`.

- IDs (`taskId`/`eventId`): URL-encoded strings (e.g., `app.tasks.add%2Fsub` for `app.tasks.add/sub`).
- Query params are ignored by current handlers and are not part of the protocol contract.

### Protocol Envelope

Task requests wrap payloads as `{ input: <value> }`. Event requests use `{ payload?: <value>, returnPayload?: boolean }`. Responses use a standard envelope:

```json
{ "ok": true, "result": <output> }  // Success
{ "ok": false, "error": { "code": "FORBIDDEN", "message": "Description" } }  // Error
```

- `ok`: Boolean.
- `result`: Task output, or event result when `returnPayload` is requested.
- `error`: Details on failure (HTTP status is provided by the HTTP response status code; `error.code` is a string).
- `meta` (optional/reserved): Present in the shared `ProtocolEnvelope` shape but currently not emitted by the RPC lanes HTTP exposure runtime.

## Common Elements

### Serialization

- All JSON bodies/responses are serialized with Runner's serializer to preserve types like `Date`, `RegExp`, and custom classes (via `addType`).
- Files are **not** custom serializer types: use sentinels `{"$runnerFile": "File", "id": "<uuid>", "meta": {...}}` (see Multipart Mode).
- Charset: UTF-8.
- Custom Types: Client/server must sync explicit `addType({ id, is, serialize, deserialize, ... })` registrations on the serializer used by the transport boundary.
- Server default: `rpcLanesResource` uses `resources.serializer` unless you override `rpcLanesResource.with({ serializer: customSerializerResource, ... })`.
- Client default: Runner HTTP communicator helpers use the serializer injected into the communicator resource dependencies, falling back to a fresh `new Serializer()` only when none is provided.

### Authentication

- **Header**: Default `x-runner-token: <token>` (configurable via `exposure.http.auth.header` and in clients).
- **Lane JWT**: Remote Lanes may use binding-level JWT auth via `binding.auth` (default header `authorization: Bearer <jwt>` unless binding overrides header).
- **Layering**: `x-runner-token` (or custom `auth.header`) is exposure-level auth; lane JWT is an independent lane authorization layer.
- **Token**: `auth.token` supports a string or string[] (any match is accepted).
- **Validators**: If tasks tagged with `tags.authValidator` exist, they are executed (OR logic); any validator returning `{ ok: true }` authenticates the request.
- **Anonymous access**: If no token and no validators exist, RPC lanes HTTP exposure fails closed by default with `500 AUTH_NOT_CONFIGURED`. Set `auth.allowAnonymous: true` to explicitly allow unauthenticated access.
- **Dynamic headers**: Clients can override per-request headers via `options.headers` and mutate headers in `onRequest({ headers })`.
- **Allow-Lists**: Server restricts to configured exposure allow-list sources (`rpcLanesResource` serve topology in `mode: "network"`). `auth.allowAnonymous` does not widen this allow-list. Unknown IDs → 403 Forbidden.
- **Lane authorization**: For served RPC lanes with binding auth enabled, token verification is lane-specific and happens before task/event execution.
- **Served endpoints required**: RPC-lanes-owned HTTP exposure only starts when the active profile serves at least one RPC task or event. If nothing is served, startup skips HTTP exposure and logs `rpc-lanes.exposure.skipped`; `auth.allowAnonymous` does not force exposure to boot.
- **Auth audit logs**: Failed authentication attempts are logged (`exposure.auth.failure`) with request metadata and correlation id.

### Header Reference

| Header                   | Direction         | Required                                 | Description                                                                                                                                                                                                                                                                |
| ------------------------ | ----------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x-runner-token`         | client -> server  | Yes (unless `auth.allowAnonymous: true`) | Authentication token. Header name can be overridden by `auth.header`.                                                                                                                                                                                                      |
| `x-runner-request-id`    | client <-> server | Optional                                 | Correlation id. Server accepts valid incoming ids and otherwise generates one; response echoes final id.                                                                                                                                                                   |
| `x-runner-context`       | client -> server  | Optional                                 | Serializer-encoded async-context map. Server restores only registered contexts and applies lane/exposure async-context policy (lane `asyncContexts` allowlist defaults to none; legacy `allowAsyncContext` bridge can temporarily allow all). Invalid entries are ignored. |
| `content-type`           | client -> server  | Recommended                              | Request mode selector (`application/json`, `multipart/form-data`, `application/octet-stream`). If omitted, the server falls back to the JSON path.                                                                                                                       |
| `X-Content-Type-Options` | server -> client  | Always                                   | Security header set to `nosniff`.                                                                                                                                                                                                                                          |
| `X-Frame-Options`        | server -> client  | Always                                   | Security header set to `DENY`.                                                                                                                                                                                                                                             |

### Error Handling

- **HTTP Status**: 200 (OK/success), 4xx (client errors), 5xx (server errors).
- **JSON Errors**: Enveloped when the response has not started yet; once a stream/response is written, subsequent errors are best-effort only.
- **Sanitization**: For `500` errors, RPC lanes HTTP exposure sanitizes the payload to avoid leaking sensitive internals:
  - `error.message` becomes `"Internal Error"` unless the server recognized a typed error.
  - typed errors may preserve `error.id`, `error.data`, and the typed error message.
- **Common Codes**:
  | HTTP | error.code | Description |
  |------|------------|-------------|
  | 400 | INVALID_JSON | Malformed JSON body. |
  | 400 | INVALID_MULTIPART | Invalid multipart payload or manifest. |
  | 400 | MISSING_MANIFEST | Multipart missing `__manifest`. |
  | 400 | PARALLEL_EVENT_RETURN_UNSUPPORTED | Event is `parallel`, so `returnPayload` is not supported. |
  | 401 | UNAUTHORIZED | Invalid token or failed auth validators. |
  | 403 | FORBIDDEN | Exposure not enabled or id not in allow-list. |
  | 404 | NOT_FOUND | Task/event not found (after allow-list checks). |
  | 405 | METHOD_NOT_ALLOWED | Non-POST (except discovery). |
  | 413 | PAYLOAD_TOO_LARGE | JSON/multipart exceeded configured limits. |
  | 499 | REQUEST_ABORTED | Client aborted/closed the request. |
  | 500 | INTERNAL_ERROR | Task exception or server error (sanitized). |
  | 500 | STREAM_ERROR | Multipart stream error (sanitized). |
  | 500 | MISSING_FILE_PART | Expected file not in multipart. |
  | 500 | AUTH_NOT_CONFIGURED | No auth is configured and `allowAnonymous` is not enabled. |
- **Logging**: Server logs errors through the logger resource (`resources.logger`, for example `exposure.task.error`), plus auth failures.
- **Correlation ID**: Requests carry/receive `x-runner-request-id` (generated when absent) for end-to-end tracing.
- **Security headers**: RPC lanes HTTP exposure sets `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` on responses.

### CORS

- Configurable via exposure (`http.cors`).
- Defaults: If `http.cors` is omitted, RPC lanes HTTP exposure sets `Access-Control-Allow-Origin: *`.
- Credentials: If `credentials: true`, you must also set an explicit `origin`; otherwise no `Access-Control-Allow-Origin` is sent (browsers will block cross-origin access).
- Preflight (OPTIONS): Auto-handled with `204`.
- Headers: Defaults `Access-Control-Allow-Methods: POST, OPTIONS`; allowed headers echo `Access-Control-Request-Headers` unless `allowedHeaders` is provided; `Vary: Origin` is appended when needed.

## Endpoints

### Task Invocation (`POST /task/{taskId}`)

- **Purpose**: Run a remote task with input; returns result.
- **Auth**: Required.
- **Allow-List**: Checked against server exposure policies (`rpcLanesResource` serve topology).
- **Body Modes**: See [Request Modes](#request-modes).
- **Context**: Task receives `useRpcLaneRequestContext()` (Node-only: `{ req, res, url, headers, method, signal }`).
- **Response**:
  - Success: 200 + JSON envelope or stream (see [Response Modes](#response-modes)).
  - Errors: 4xx/5xx + JSON envelope.

### Event Emission (`POST /event/{eventId}`)

- **Purpose**: Emit a remote event with payload using RPC semantics.
- **Auth**: Required.
- **Allow-List**: Checked.
- **Body**: Always JSON mode: `{ payload?: <any>, returnPayload?: boolean }` (serialized).
- **Response**:
  - default: 200 + `{ ok: true }` (fire-and-forget behavior)
  - if `returnPayload: true`: 200 + `{ ok: true, result: <payload> }` (RPC-style event result; not supported when the event is marked `parallel`).
- **No Context**: Events don't provide `useRpcLaneRequestContext()`.

### Discovery (`GET /discovery`)

- **Purpose**: Query server allow-list for validation/discovery.
- **Auth**: Required.
- **Body**: None.
- **Methods**: `GET` only. Other non-`OPTIONS` methods return `405 METHOD_NOT_ALLOWED`.
- **Disabled Mode**: If `http.disableDiscovery` is `true`, the endpoint returns `404 NOT_FOUND`.
- **Response**: 200 + JSON:
  ```json
  {
    "ok": true,
    "result": {
      "allowList": {
        "enabled": true,
        "tasks": ["app.tasks.add", "app.tasks.upload"],
        "events": ["app.events.notify"]
      }
    }
  }
  ```
- **Use Case**: Clients fetch to check reachable IDs dynamically.

## Request Modes

Server primarily routes by `Content-Type`. If the header is omitted, requests fall back to the JSON path.

### JSON Mode

- **When**: No files/streams (default fallback).
- **Content-Type**: Usually `application/json; charset=utf-8` (omitting `content-type` still falls back to this path).
- **Body**: JSON `{ input: <any> }` (or bare `<input>`; the server treats non-object bodies as the input directly).
- **Handling**: Server parses JSON (via Runner serializer), runs task with input, serializes result.
- **Limits**: Default max body size is 2MB (`http.limits.json.maxSize`); over-limit returns 413/PAYLOAD_TOO_LARGE.
- **Limitations**: No files (use multipart); no raw streams (use octet).

### Multipart Mode

- **When**: Input contains File sentinels (client-detected).
- **Content-Type**: `multipart/form-data; boundary=<boundary>` (RFC 7578).
- **Body Parts**:
  - `__manifest` (field): JSON string of `{ input?: <obj> }`.
    - The server treats this as a plain field value; the per-part `Content-Type` is not enforced (some clients send `application/json; charset=utf-8`).
    - File placeholders: `{"$runnerFile": "File", "id": "<uuid>", "meta": { "name": string, "type"?: string, "size"?: number, "lastModified"?: number, "extra"?: object }}`
    - `<uuid>`: Client-generated (unique per request).
  - `file:<id>` (binary): File bytes for each sentinel.
    - `Content-Disposition: form-data; name="file:<id>"; filename="<name>"`
    - `Content-Type`: From meta (fallback: detected or `application/octet-stream`).
- **Handling**:
  - Parse manifest → hydrate input (replace sentinels with `InputFile` objects: `{ name, type, size?, lastModified?, extra?, resolve(): Promise<{stream: Readable}> }`).
  - Meta Precedence: Manifest overrides part headers (e.g., name/type).
  - All expected files must arrive; unconnected → 500/MISSING_FILE_PART.
  - Single-use streams: `resolve()` consumes once.
- **Limits**: Defaults are 20MB per file, 10 files, 100 fields, 1MB per field (`http.limits.multipart`); over-limit returns 413/PAYLOAD_TOO_LARGE.
- **Client Prep**: Universal/fetch clients use `buildUniversalManifest`; the Node smart client builds the equivalent manifest through its Node upload path.
- **Limitations**: Browser: Blobs/FormData. Node: Buffers/streams.

### Octet-Stream Mode

- **When**: Input is raw `Readable` (Node duplex, client-detected).
- **Content-Type**: `application/octet-stream`
- **Body**: Raw binary (piped stream).
- **Handling**: No parsing; request body is not pre-consumed and the task accesses bytes via `useRpcLaneRequestContext().req` (IncomingMessage stream).
- **Async context**: `x-runner-context` still applies (it is a header, independent of body mode).
- **Limitations**: Node-only; no JSON input (wrap in File sentinel + multipart if needed).

## Response Modes

- **Default**: JSON envelope (serialized).
- **Streaming**: If task returns `Readable` or `{ stream: Readable }`:
  - Status: 200.
  - Content-Type: `application/octet-stream` (or custom via res).
  - Body: Piped stream (chunked encoding).
  - No envelope (direct bytes).
- **Events**: JSON envelope. Default is `{ ok: true }`; `returnPayload: true` returns `{ ok: true, result: <payload> }`.
- **Errors**: JSON envelope (even on streams, if not already written).

## Extensions

### Abort and Timeouts

- **Client**: Set `timeoutMs` → `AbortController` (signal aborts request).
- **Server**: Wires signal to task (`useRpcLaneRequestContext().signal`); aborts streams.
- **Response**: 499/REQUEST_ABORTED on abort.
- **Hook**: Tasks check `signal.aborted` or listen for "abort".

### Compression

- **Status**: Not implemented in core (use a proxy like nginx for compression); future: zlib integration.
- **Security**: Avoid BREACH risks (no secrets near user data).

### Context Propagation (Node-Only)

- **Mechanism**: Snapshots registered async contexts created via `defineAsyncContext({ id })`.
- **Transport**: A Serializer-encoded map sent in `x-runner-context` header (applies to JSON, multipart, and octet-stream).
- **Rules**: Stable IDs; optional `serialize`/`parse` hooks. Contexts that cannot be captured or parsed are skipped rather than failing the whole request.
- **Security**: Server only restores known registered contexts; invalid headers/entries are ignored.
- **Gate**: Set `allowAsyncContext: false` on the relevant server RPC-lane binding to disable server-side hydration of `x-runner-context` as a legacy bridge when no lane `asyncContexts` allowlist is configured.

### Streaming

- **Duplex**: Octet mode (req → task processing → res stream).
- **Server Push**: Task returns stream → piped to res.
- **Client**: `createHttpSmartClient` returns `Readable`; `createHttpMixedClient` auto-switches.
- **Abort**: Signal destroys pipes.

## Examples

### JSON Task (curl)

```bash
curl -X POST http://localhost:7070/__runner/task/app.tasks.add \
  -H "x-runner-token: secret" \
  -H "Content-Type: application/json" \
  -d '{"input": {"a": 1, "b": 2}}'
```

Response:

```json
{ "ok": true, "result": 3 }
```

### Multipart Upload (Node-like, conceptual curl)

Manifest JSON: `{"input": {"file": {"$runnerFile": "File", "id": "f1", "meta": {"name": "doc.txt", "type": "text/plain"}}}}`

```bash
curl -X POST http://localhost:7070/__runner/task/app.tasks.upload \
  -H "x-runner-token: secret" \
  -F '__manifest={"input": {"file": {"$runnerFile": "File", "id": "f1", "meta": {"name": "doc.txt"}}}}' \
  -F 'file:f1=@/path/to/doc.txt'
```

Response: `{"ok": true, "result": {"bytes": 1024}}`

### Octet Duplex (Node-only, conceptual)

Client pipes `Readable` (e.g., fs.createReadStream); server echoes via `req.pipe(res)`.

### Event Emission

```bash
curl -X POST http://localhost:7070/__runner/event/app.events.notify \
  -H "x-runner-token: secret" \
  -H "Content-Type: application/json" \
  -d '{"payload": {"message": "hi"}}'
```

Response: `{"ok": true}`

## References

- [COMPACT_GUIDE.md](./COMPACT_GUIDE.md): High-level fluent API.
- [REMOTE_LANES.md](REMOTE_LANES.md): Usage, examples, troubleshooting.
- Code: `src/node/rpc-lanes/rpcLanes.exposure.ts`, `src/node/exposure/` (server), [`src/http-client.ts`](../src/http-client.ts), [`src/node/http/http-smart-client.model.ts`](../src/node/http/http-smart-client.model.ts), and [`src/node/http/http-mixed-client.ts`](../src/node/http/http-mixed-client.ts) (clients).
- Standards: HTTP/1.1 (RFC 7230), Multipart (RFC 7578), JSON.

---

_Last Updated: March 17, 2026_
