# Runner Tunnel HTTP Protocol Policy (v1.0)

← [Back to main README](../README.md)

> **Status**: Draft spec derived from Runner 4.x implementation. This document formalizes the wire protocol for HTTP tunnels, enabling interoperability, debugging, and future extensions. It is not a normative standard but reflects the current behavior of `nodeExposure` and clients like `createHttpClient`. For usage, see [TUNNELS.md](TUNNELS.md).

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
  - [Versioning](#versioning)
  - [References](#references)

## Overview

The Runner tunnel HTTP protocol enables remote invocation of tasks and emission of events across processes (e.g., Node server to browser or CLI) using standard HTTP. It is stateless, extensible, and optimized for Runner's dependency injection, middleware, and validation model.

### Goals

- **Simplicity**: Minimal overhead; leverages HTTP/1.1+ with serialized JSON for structured data.
- **Cross-Platform**: Works in Node (streams/files) and browsers (fetch/FormData).
- **Security**: Mandatory auth, allow-lists, CORS, abort handling.
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
{ "ok": false, "error": { "code": 200, "message": "Description", "codeName": "OK" } }  // Error
```

- `ok`: Boolean.
- `result`: Task output (serialized; omitted for events).
- `error`: Details on failure (HTTP status maps to `code`).

## Common Elements

### Serialization

- All JSON bodies/responses are serialized with Runner's serializer to preserve types like `Date`, `RegExp`, and custom classes (via `addType`).
- Files are **not** custom serializer types: use sentinels `{"$runnerFile": "File", "id": "<uuid>", "meta": {...}}` (see Multipart Mode).
- Charset: UTF-8.
- Custom Types: Client/server must sync `addType(name, factory)` via DI (`globals.resources.serializer`).

### Authentication

- **Header**: Default `x-runner-token: <token>` (configurable via `header` in exposure/client config).
- **Alternatives**: `Authorization: Bearer <token>` (via `onRequest` callback).
- **Dynamic**: Clients can override per-request via `onRequest({ headers })`.
- **Failure**: 401 Unauthorized + JSON error.
- **Allow-Lists**: Server restricts to tagged resources (`globals.tags.tunnel`, `mode: "server"`, `transport: "http"`). Unknown IDs → 403 Forbidden.
- **Exposure disabled**: If no server-mode HTTP tunnel is registered, task/event requests return 403 (fail-closed).

### Error Handling

- **HTTP Status**: 200 (OK/success), 4xx (client errors), 5xx (server errors).
- **JSON Errors**: Always enveloped (even on streams, if possible).
- **Common Codes**:
  | Code | HTTP | codeName | Description |
  |------|------|----------|-------------|
  | 400 | 400 | INVALID_JSON | Malformed JSON body. |
  | 400 | 400 | INVALID_MULTIPART | Multipart missing/invalid manifest or parts. |
  | 401 | 401 | UNAUTHORIZED | Invalid/missing token. |
  | 403 | 403 | FORBIDDEN | ID not in allow-list. |
  | 404 | 404 | NOT_FOUND | Task/event missing. |
  | 405 | 405 | METHOD_NOT_ALLOWED | Non-POST (except discovery). |
  | 499 | 499 | REQUEST_ABORTED | Client abort/timeout. |
  | 500 | 500 | INTERNAL_ERROR | Task exception or server error. |
  | 500 | 500 | STREAM_ERROR | Multipart stream failure. |
  | 500 | 500 | MISSING_FILE_PART | Expected file not in multipart. |
- **Logging**: Server logs errors via `globals.resources.logger` (e.g., "exposure.task.error").

### CORS

- Configurable via exposure (`http.cors`).
- Defaults: Permissive (`Access-Control-Allow-Origin: *`; echoes for credentials).
- Preflight (OPTIONS): Auto-handled.
- Headers: `Access-Control-Allow-Methods: POST, OPTIONS`; `Vary: Origin` if echoing.

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
- **Body**: Always JSON mode: `{ payload: <any> }` (serialized).
- **Response**: 200 + `{ ok: true }` or error envelope.
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
- **Body**: JSON `{ input: <any> }` (or bare `<input>` if simple).
- **Handling**: Server parses JSON (via Runner serializer), runs task with input, serializes result.
- **Limitations**: No files (use multipart); no raw streams (use octet).

### Multipart Mode

- **When**: Input contains File sentinels (client-detected).
- **Content-Type**: `multipart/form-data; boundary=<boundary>` (RFC 7578).
- **Body Parts**:
  - `__manifest` (text/plain): JSON string of `{ input: <obj> }`.
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
- **Client Prep**: Use `buildUniversalManifest` (clones input, collects sources).
- **Limitations**: Browser: Blobs/FormData. Node: Buffers/streams.

### Octet-Stream Mode

- **When**: Input is raw `Readable` (Node duplex, client-detected).
- **Content-Type**: `application/octet-stream`
- **Body**: Raw binary (piped stream).
- **Handling**: No parsing; task accesses via `useExposureContext().req` (IncomingMessage stream).
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

- **Request**: Client optional (gzip via `onRequest`); server decompresses if `Content-Encoding`.
- **Response**: Server negotiates via `Accept-Encoding` (gzip/br); compresses JSON/streams.
- **Status**: Not implemented in core (use proxy like nginx); future: zlib integration.
- **Security**: Avoid BREACH risks (no secrets near user data).

### Context Propagation (Node-Only)

- **Mechanism**: Snapshots `AsyncLocalStorage` (created via `createContext(id: string)`).
- **Transport**:
  - JSON/Multipart: Serialized map sent in `x-runner-context` header.
  - Octet: Headers for small values; envelope prefix (length + serialized) for full.
- **Rules**: Stable IDs; optional `serialize`/`parse` hooks. Filtered for size/serializability.
- **Security**: Server validates before restore; caps size.

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

## Versioning

- **v1.0**: Current (Runner 4.x). Base: `/__runner`, serialized envelopes, modes as above.
- **Future**:
  - v2: Binary protocol (e.g., Protocol Buffers over HTTP/2).
  - Headers: `X-Runner-Protocol-Version: 1.0`.
- **Breaking Changes**: New base path or envelope; announce in changelog.

## References

- [AI.md](./AI.md): High-level fluent API.
- [TUNNELS.md](TUNNELS.md): Usage, examples, troubleshooting.
- Code: `src/node/exposure/` (server), `src/node/http-smart-client.model.ts` (clients).
- Standards: HTTP/1.1 (RFC 7230), Multipart (RFC 7578), JSON.

---

_Last Updated: September 24, 2025_
