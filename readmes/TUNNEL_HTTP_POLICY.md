# Runner Tunnel HTTP Protocol Policy (v1.0)

> **Status**: Draft spec derived from Runner implementation. This document formalizes the wire protocol for HTTP tunnels, enabling interoperability, debugging, and future extensions. It is not a normative standard but reflects the current behavior of `nodeExposure` and clients like `createExposureFetch` / `createHttpClient`. For usage, see [TUNNELS.md](TUNNELS.md).

## Table of Contents

- [Runner Tunnel HTTP Protocol Policy (v1.0)](#runner-tunnel-http-protocol-policy-v10)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
    - [Goals](#goals)
    - [Base Path](#base-path)
    - [Protocol Envelope](#protocol-envelope)
  - [Common Elements](#common-elements)
    - [Serialization](#serialization)
    - [Authentication](#authentication)
    - [Error Handling](#error-handling)
    - [CORS](#cors)
  - [Endpoints](#endpoints)
    - [Task Invocation (`POST /task/{taskId}`)](#task-invocation-post-tasktaskid)
    - [Event Emission (`POST /event/{eventId}`)](#event-emission-post-eventeventid)
    - [Discovery (`GET|POST /discovery`)](#discovery-getpost-discovery)
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

The Runner tunnel HTTP protocol enables remote invocation of tasks and emission of events across processes (e.g., Node server to browser or CLI) using standard HTTP. It is stateless, extensible, and optimized for Runner's dependency injection, middleware, and validation model.

### Goals

- **Simplicity**: Minimal overhead; leverages HTTP/1.1+ with serialized JSON for structured data.
- **Cross-Platform**: Works in Node (streams/files) and browsers (fetch/FormData).
- **Security**: Auth (fail-closed by default), allow-lists, CORS, abort handling.
- **Efficiency**: Supports streaming (duplex/raw) and files (manifest-based multipart) without buffering.
- **Observability**: Logs, context propagation, discovery endpoint.

### Base Path

All endpoints are under a configurable base path (default: `/__runner`). Example: `http://localhost:7070/__runner/task/app.tasks.add`.

- IDs (`taskId`/`eventId`): URL-encoded strings (e.g., `app.tasks.add%2Fsub` for `app.tasks.add/sub`).
- No query params (body-only for payloads).

### Protocol Envelope

Requests (JSON/multipart) wrap payloads in objects like `{ input: <value> }`. Responses use a standard envelope:

```json
{ "ok": true, "result": <output> }  // Success
{ "ok": false, "error": { "code": "FORBIDDEN", "message": "Description" } }  // Error
```

- `ok`: Boolean.
- `result`: Task output (serialized; omitted for events).
- `error`: Details on failure (HTTP status is provided by the HTTP response status code; `error.code` is a string).
- `meta` (optional/reserved): Present in the shared `ProtocolEnvelope` shape but currently not emitted by `nodeExposure`.

## Common Elements

### Serialization

- All JSON bodies/responses are serialized with Runner's serializer to preserve types like `Date`, `RegExp`, and custom classes (via `addType`).
- Files are **not** custom serializer types: use sentinels `{"$runnerFile": "File", "id": "<uuid>", "meta": {...}}` (see Multipart Mode).
- Charset: UTF-8.
- Custom Types: Client/server must sync `addType(name, factory)` via DI (`globals.resources.serializer`).

### Authentication

- **Header**: Default `x-runner-token: <token>` (configurable via `auth.header` in `nodeExposure` and in clients).
- **Token**: `auth.token` supports a string or string[] (any match is accepted).
- **Validators**: If tasks tagged with `globals.tags.authValidator` exist, they are executed (OR logic); any validator returning `{ ok: true }` authenticates the request.
- **Anonymous access**: If no token and no validators exist, `nodeExposure` fails closed by default with `500 AUTH_NOT_CONFIGURED`. Set `auth.allowAnonymous: true` to explicitly allow unauthenticated access.
- **Dynamic headers**: Clients can override per-request via `onRequest({ headers })`.
- **Allow-Lists**: Server restricts to tagged resources (`globals.tags.tunnel`, `mode: "server"`, `transport: "http"`). Unknown IDs → 403 Forbidden.
- **Exposure disabled**: If no server-mode HTTP tunnel is registered, task/event requests return 403 (fail-closed), unless `http.dangerouslyAllowOpenExposure: true` is set.

### Error Handling

- **HTTP Status**: 200 (OK/success), 4xx (client errors), 5xx (server errors).
- **JSON Errors**: Enveloped when the response has not started yet; once a stream/response is written, subsequent errors are best-effort only.
- **Sanitization**: For `500` errors, `nodeExposure` sanitizes the payload to avoid leaking sensitive internals:
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
- **Logging**: Server logs errors via `globals.resources.logger` (e.g., "exposure.task.error").
- **Security headers**: `nodeExposure` sets `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` on responses.

### CORS

- Configurable via exposure (`http.cors`).
- Defaults: If `http.cors` is omitted, `nodeExposure` sets `Access-Control-Allow-Origin: *`.
- Credentials: If `credentials: true`, you must also set an explicit `origin`; otherwise no `Access-Control-Allow-Origin` is sent (browsers will block cross-origin access).
- Preflight (OPTIONS): Auto-handled with `204`.
- Headers: Defaults `Access-Control-Allow-Methods: POST, OPTIONS`; allowed headers echo `Access-Control-Request-Headers` unless `allowedHeaders` is provided; `Vary: Origin` is appended when needed.

## Endpoints

### Task Invocation (`POST /task/{taskId}`)

- **Purpose**: Run a remote task with input; returns result.
- **Auth**: Required.
- **Allow-List**: Checked against server tunnels.
- **Body Modes**: See [Request Modes](#request-modes).
- **Context**: Task receives `useExposureContext()` (Node-only: `{ req, res, url, headers, method, signal }`).
- **Response**:
  - Success: 200 + JSON envelope or stream (see [Response Modes](#response-modes)).
  - Errors: 4xx/5xx + JSON envelope.

### Event Emission (`POST /event/{eventId}`)

- **Purpose**: Emit a remote event with payload; fire-and-forget (no result).
- **Auth**: Required.
- **Allow-List**: Checked.
- **Body**: Always JSON mode: `{ payload?: <any>, returnPayload?: boolean }` (serialized).
- **Response**:
  - default: 200 + `{ ok: true }`
  - if `returnPayload: true`: 200 + `{ ok: true, result: <payload> }` (not supported when the event is marked `parallel`).
- **No Context**: Events don't provide `useExposureContext()`.

### Discovery (`GET|POST /discovery`)

- **Purpose**: Query server allow-list for validation/discovery.
- **Auth**: Required.
- **Body**: None.
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

Server routes by `Content-Type`.

### JSON Mode

- **When**: No files/streams (default fallback).
- **Content-Type**: `application/json; charset=utf-8`
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
- **Client Prep**: Use `buildUniversalManifest` (clones input, collects sources).
- **Limitations**: Browser: Blobs/FormData. Node: Buffers/streams.

### Octet-Stream Mode

- **When**: Input is raw `Readable` (Node duplex, client-detected).
- **Content-Type**: `application/octet-stream`
- **Body**: Raw binary (piped stream).
- **Handling**: No parsing; request body is not pre-consumed and the task accesses bytes via `useExposureContext().req` (IncomingMessage stream).
- **Async context**: `x-runner-context` still applies (it is a header, independent of body mode).
- **Limitations**: Node-only; no JSON input (wrap in File sentinel + multipart if needed).

## Response Modes

- **Default**: JSON envelope (serialized).
- **Streaming**: If task returns `Readable` or `{ stream: Readable }`:
  - Status: 200.
  - Content-Type: `application/octet-stream` (or custom via res).
  - Body: Piped stream (chunked encoding).
  - No envelope (direct bytes).
- **Events**: Always `{ ok: true }`.
- **Errors**: JSON envelope (even on streams, if not already written).

## Extensions

### Abort and Timeouts

- **Client**: Set `timeoutMs` → `AbortController` (signal aborts request).
- **Server**: Wires signal to task (`useExposureContext().signal`); aborts streams.
- **Response**: 499/REQUEST_ABORTED on abort.
- **Hook**: Tasks check `signal.aborted` or listen for "abort".

### Compression

- **Status**: Not implemented in core (use a proxy like nginx for compression); future: zlib integration.
- **Security**: Avoid BREACH risks (no secrets near user data).

### Context Propagation (Node-Only)

- **Mechanism**: Snapshots `AsyncLocalStorage` (created via `createContext(id: string)`).
- **Transport**: A Serializer-encoded map sent in `x-runner-context` header (applies to JSON, multipart, and octet-stream).
- **Rules**: Stable IDs; optional `serialize`/`parse` hooks. Filtered for size/serializability.
- **Security**: Server only restores known registered contexts; invalid headers/entries are ignored.

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

- [AI.md](./AI.md): High-level fluent API.
- [TUNNELS.md](TUNNELS.md): Usage, examples, troubleshooting.
- Code: `src/node/exposure/` (server), `src/node/http/http-smart-client.model.ts` (clients).
- Standards: HTTP/1.1 (RFC 7230), Multipart (RFC 7578), JSON.

---

_Last Updated: February 2, 2026_
