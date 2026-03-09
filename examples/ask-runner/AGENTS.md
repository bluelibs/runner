# AGENTS.md

This file explains the intent and current architecture of `examples/ask-runner`.

## Purpose

`ask-runner` is a small public-facing Runner app that answers questions about BlueLibs Runner using `readmes/AI.md` as its source material.

It is not just a demo of OpenAI usage. It is meant to show a Runner-style composition:

- `resource` owns lifecycle and shared services
- `task` owns business actions
- `middleware` owns cross-cutting policy
- HTTP is an ingress adapter, not the business layer

When changing this example, preserve that shape unless there is a strong reason not to.

## Current Architecture

### App graph

The root graph is assembled in `src/app/app.resource.ts`.

Registered pieces:

- config resource
- budget ledger resource
- docs prompt resource
- OpenAI client resource
- OpenAI semaphore resource
- ask-task budget middleware
- ask tasks
- HTTP route tag
- admin/health endpoint tasks
- HTTP router resource
- HTTP server resource

Important rule:

- Custom middleware must be registered in the app graph, not only attached to tasks. If you add a task middleware and forget to register it, runtime boot will fail with `middlewareNotRegistered`.

### AI path

Relevant files:

- `src/app/ai/prompt.ts`
- `src/app/ai/ask-runner-request.ts`
- `src/app/ai/ask-runner.middleware.ts`
- `src/app/ai/ask-runner.task.ts`
- `src/app/ai/openai-stream.ts`

Responsibilities:

- `prompt.ts`
  - owns the system prompt persona and static instructions
  - keeps the assistant scoped to Runner
  - currently biases the assistant toward being an honest, pro-Runner “seller”
- `ask-runner-request.ts`
  - owns the OpenAI request shape shared by streaming and non-streaming tasks
- `ask-runner.middleware.ts`
  - owns query normalization
  - owns input length validation
  - owns budget preflight and IP limit enforcement
  - owns final usage accounting
- `ask-runner.task.ts`
  - owns the actual OpenAI call
  - keeps retry/circuit/timeout around the task
  - uses a separate streaming task because streaming and non-streaming have different contracts
- `openai-stream.ts`
  - consumes OpenAI stream events and writes markdown deltas to a provided writer

Design decision:

- Budget admission and usage recording were intentionally moved out of the HTTP resource and into task middleware so the task boundary is the policy boundary.

### HTTP path

Relevant files:

- `src/app/http/http-route.tag.ts`
- `src/app/http/http-router.resource.ts`
- `src/app/http/http.resource.ts`
- `src/app/http/http-endpoints.task.ts`
- `src/app/http/query-request.ts`
- `src/app/http/stream-html-page.ts`

Responsibilities:

- `http-route.tag.ts`
  - owns typed route metadata for task discovery
  - stays intentionally small and only describes route-level transport metadata
- `http-router.resource.ts`
  - discovers tagged endpoint tasks
  - registers normal task-backed routes on the shared Express app
  - handles router-level HTTP-only concerns such as admin header auth and simple response serialization
- `http.resource.ts`
  - owns Express lifecycle only
  - registers only the special explicit routes (`/`, `/stream`, `/stream-html`)
  - handles shared Express setup plus final error serialization
- `http-endpoints.task.ts`
  - owns `/health`, `/admin/budget`, `/admin/resume`, `/admin/stop-for-day`
  - carries route metadata for the tagged router
- `query-request.ts`
  - should stay a transport helper
  - currently extracts `{ query, ip }` and contains projected-cost estimation helper used by task middleware
- `stream-html-page.ts`
  - owns the static browser viewer served by `/stream-html`
  - keeps client-side markdown rendering separate from route wiring

Design decision:

- Do not reintroduce large `handleRequest` abstractions unless they reduce duplication materially.
- Keep the route handlers easy to read: parse HTTP input, call task, serialize response.
- Use tags plus the router resource for simple task-backed endpoints, but keep special streaming/page routes explicit.
- Keep `/stream-html` as a page-level transport adapter over `/stream`, not as a new business task.

## What To Preserve

### Keep resources as resources

These are correctly modeled as resources:

- config
- prompt docs
- OpenAI client
- semaphore
- budget ledger
- HTTP server

Do not turn these into tasks.

### Keep actions as tasks

These are correctly modeled as tasks:

- ask
- stream ask
- health
- budget snapshot
- stop-for-day
- resume

If a route performs a business action, prefer a task over direct resource method calls in the route.

### Keep streaming separate

Do not merge `/` and `/stream` into one overloaded task.

Reason:

- non-streaming returns a final typed object
- streaming writes incrementally to a sink
- retry semantics differ
- error handling differs once bytes are sent

## Important Behavior

### Ask task inputs

`askRunnerTask` and `streamAskRunnerTask` take:

- `query`
- `ip`
- plus `writer` for stream

The IP is passed from HTTP because rate limiting is transport-derived.

### Budget enforcement

Budget and rate limits are enforced in `askRunnerBudgetMiddleware`, not in the route.

That middleware:

- trims the query
- rejects empty input
- rejects overly long input
- computes projected cost
- enforces IP minute/hour/day limits
- enforces day budget admission
- records usage after successful completion

### Prompt stance

The assistant is intentionally:

- scoped only to Runner
- prompt-injection resistant at the instruction level
- concise and technical by default
- more jovial and persuasive for “why Runner is great / better” style questions
- still required to avoid unsupported claims

If you change the prompt, update `src/__tests__/prompt.test.ts`.

## Known Weak Spots / Future Work

These are important if you are modifying the example:

### IP trust

Current IP extraction in `query-request.ts` relies on Express `req.ip`, with a socket fallback.

This is intentional:

- Express `trust proxy` controls whether forwarded headers are honored
- app code does not manually parse `x-forwarded-for`
- IP-based rate limiting should follow Express proxy trust, not custom header logic

If you change IP handling:

- prefer `req.ip`
- let `trust proxy` remain the single source of truth
- do not reintroduce manual `x-forwarded-for` parsing in app code

### Streaming disconnect handling

Current `/stream` still has a known correctness/security gap:

- if the client disconnects mid-stream, upstream spend may continue
- final usage accounting may be skipped on disconnect/error paths

Safer future direction:

- create an `AbortController` per stream request
- cancel the OpenAI request when the HTTP client disconnects
- ensure usage or at least estimated spend is recorded even on partial-stream failure

If you touch streaming, review `src/app/ai/openai-stream.ts` and `src/app/http/http.resource.ts` together.

## Testing

Run:

```bash
npm run qa
```

Test layout:

- `src/__tests__/http.test.ts`
  - verifies route wiring and HTTP behavior
- `src/__tests__/http-endpoints.task.test.ts`
  - verifies admin/health endpoint tasks
- `src/__tests__/prompt.test.ts`
  - locks prompt contract
- `src/__tests__/budget-ledger.test.ts`
  - covers ledger rules

When changing architecture:

- prefer updating tests to reflect the boundary you want
- do not let route tests become ledger-policy tests if the policy lives in middleware/tasks

## Editing Guidance For Future Agents

- Prefer small files and decouple early.
- Keep the HTTP resource thin.
- Prefer custom task middleware over repeating policy in routes.
- Register middleware explicitly in `app.resource.ts`.
- Use task dependencies directly from `deps`, not `resources.taskRunner`, inside this app.
- For admin routes, keep header auth at the HTTP boundary because it is transport-specific.
- If you introduce a new public behavior, update the example `README.md` when appropriate.

## Mental Model

If you are unsure where code belongs, use this rule:

- “Does this own process/service lifecycle or shared state?” -> resource
- “Is this the business action?” -> task
- “Is this a cross-cutting concern around a task?” -> middleware
- “Is this only about HTTP parsing or response writing?” -> route adapter

That rule is the main design intent of this mini-codebase.
