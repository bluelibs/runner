# Runner Agents: High-level architecture and spec

This document sketches how to build an “agent framework” on top of BlueLibs Runner using only first-class primitives: resources, tasks, events, middleware, tags, and context. It also proposes a minimal spec and a codegen approach to produce runnable apps from a declarative description.

## Goals

- Treat agents as orchestrators with abilities (tasks) and tools (stateful resources/factories).
- Keep everything type-safe, composable, and testable (DI-first, overrides-friendly).
- Support multiple transports (CLI/HTTP/Queue) without coupling agent logic to I/O.
- Enable declarative composition via a simple spec that can be code‑generated.

## Core mapping to Runner

- Resources: models/state/services/tools
  - Long-lived or factory-shaped; validate config at `.with()`.
  - Examples: Memory stores, vector DBs, HTTP clients, planner models, cache, router.
- Tasks: abilities/behaviours
  - Can call other tasks; accept input and produce output; wrapped in middleware.
  - Use `task.intercept()` for per-task interception, or global middleware for cross-cutting.
- Events & Hooks: communication
  - Agents emit lifecycle/telemetry events; hooks listen and react (stoppable and ordered).
- Tags: discovery & programmatic wiring
  - Tag resources as tools, tasks as abilities, and group by agent.
- Context: request-/conversation-scoped data
  - Pass user/session/run metadata through middlewares and nested tasks.
- Middleware: cross-cutting concerns
  - Retry, timeout, cache, auth, rate limit, tracing, input/result validation.

## Canonical tags (recommended)

- `agents.agent` — marks the agent definition (resource) with config (name, defaults).
- `agents.tool` — marks a resource/factory as a tool; optional public contract.
- `agents.ability` — marks a task as an ability; ties to one or more agents.

These tags are only metadata; wiring happens at runtime in a `ready` hook using the `store`.

### Example tag contracts (TypeScript)

```ts
import { tag } from "@bluelibs/runner";

export const agentTag = tag<{
  name: string;
  description?: string;
  tools?: string[]; // tool ids this agent expects
  planner?: string; // task id that decides next step
  middleware?: string[]; // middleware ids to attach to agent entry
}>({ id: "agents.agent" });

export const toolTag = tag<{
  name: string;
  kind?: "factory" | "resource";
  forAgents?: string[]; // optional whitelist
}>({ id: "agents.tool" });

export const abilityTag = tag<{
  name: string;
  agentIds?: string[]; // which agents can use this ability
  role?: "system" | "core" | "aux";
}>({ id: "agents.ability" });
```

## Minimal spec (to drive codegen)

Use a simple JSON/YAML/TS spec to describe agents, tools, abilities, middleware, and events. A generator converts this spec into Runner definitions (resources/tasks/tags/hooks).

### Types (conceptual)

```ts
export type ToolKind = "factory" | "resource";

export interface ToolSpec {
  id: string; // resource id
  kind: ToolKind;
  config?: unknown; // validated at resource.with(config)
  tags?: string[]; // extra tags
}

export interface AbilitySpec {
  id: string; // task id
  inputType?: string; // optional type name
  outputType?: string; // optional type name
  middleware?: string[];
  forAgents?: string[]; // mount on these agents
  tags?: string[];
}

export interface AgentSpec {
  id: string; // resource id
  name: string;
  tools: string[]; // ToolSpec ids required/optional (by convention: suffix ? for optional)
  abilities: string[]; // AbilitySpec ids to expose
  planner?: string; // task id
  memory?: string; // tool id (resource)
  middleware?: string[]; // agent-level middleware (applied to entry task)
}

export interface MiddlewareSpec {
  id: string; // task or resource middleware id
  scope: "task" | "resource";
  config?: unknown;
}

export interface EventSpec {
  id: string; // event id
  payloadType?: string;
}

export interface AppSpec {
  agents: AgentSpec[];
  tools: ToolSpec[];
  abilities: AbilitySpec[];
  middleware?: MiddlewareSpec[];
  events?: EventSpec[];
  transports?: Array<
    | { kind: "http"; basePath?: string; agentRoutes?: Record<string, string> }
    | { kind: "cli" }
    | { kind: "queue"; topic?: string }
  >;
}
```

### Tiny spec example (YAML)

```yaml
agents:
  - id: app.agents.support
    name: SupportAgent
    tools: [app.tools.memory, app.tools.search?]
    abilities: [app.abilities.summarize, app.abilities.answer]
    planner: app.abilities.plan
    memory: app.tools.memory
    middleware: [app.middleware.timeout(15000), app.middleware.retry(3)]

tools:
  - id: app.tools.memory
    kind: resource
  - id: app.tools.search
    kind: factory

abilities:
  - id: app.abilities.summarize
  - id: app.abilities.answer
  - id: app.abilities.plan

transports:
  - kind: http
    basePath: /agents
    agentRoutes:
      app.agents.support: /support/run
```

## Code generation outline

- Input: `app.spec.yaml` (or TS/JSON)
- Output: `src/agents/**` (generated)
  - `tools.ts` — resource/factory stubs with `toolTag`
  - `abilities.ts` — task stubs with `abilityTag`
  - `agents.ts` — resource definitions with `agentTag`
  - `wiring.hook.ts` — a `globals.events.ready` hook that discovers and wires by tags
  - Optional: `http.routes.hook.ts` if HTTP transport is requested
- Emit type placeholders and TODOs; developers fill in business logic, keep wiring intact.
- Prefer id stability across runs; regenerate idempotently (update blocks via markers or dedicated folder).

## Runtime wiring pattern (ready hook)

At `globals.events.ready`:

1. Fetch all tasks with `abilityTag` and resources with `toolTag`/`agentTag` using `store`.
2. For each agent resource:
   - Attach its tools (DI dependencies) and abilities (callable tasks) based on tags/config.
   - If a planner is present, wrap the execution loop.
   - Compose agent-level middleware on the entry task (or via intercept).
3. If transports are configured (HTTP/CLI/Queue), register routes/commands that call the agent entry task.

Pseudocode:

```ts
import { hook, globals } from "@bluelibs/runner";
import { agentTag, toolTag, abilityTag } from "./agents.tags";

export const wireAgents = hook({
  id: "app.hooks.wireAgents",
  on: globals.events.ready,
  dependencies: { store: globals.resources.store },
  run: async (_, { store }) => {
    const agents = store.getResourcesWithTag(agentTag);
    const tools = store.getResourcesWithTag(toolTag);
    const abilities = store.getTasksWithTag(abilityTag);

    // Index tools and abilities by id for quick lookup
    const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));
    const toolIndex = byId(tools);
    const abilityIndex = byId(abilities);

    agents.forEach((agent) => {
      const cfg = agentTag.extract(agent.meta?.tags || []);
      if (!cfg?.config) return;

      // Example: inject agent-specific interceptors or shared middleware
      // agent.intercept?.(...)

      // Optionally register transport endpoints here
    });
  },
});
```

## Execution loop (agent entry task)

Define a single entry task per agent (generated) that:

- Accepts a structured input (message, goal, attachments, user context).
- Uses middleware: `timeout`, `retry`, `cache`, `requireContext`, `auth`, `rateLimit`.
- Emits events for observability and tooling:
  - `agents.events.started` | `step.started` | `step.finished` | `finished` | `error`.
- Delegates to planner (optional) to decide the next ability/tool call as a structured plan (no hidden CoT).
- Runs abilities (tasks) and tools (resources/factories) with proper DI.
- Uses `Queue` for cooperative cancellation and ordered steps; `Semaphore` for rate‑limited parallel calls when safe.

Contract suggestion (inputs/outputs):

- Input: `{ agentId, sessionId, user: { id }, message: string, context?: any }`
- Output: `{ status: "ok" | "error", result?: any, steps: StepLog[], usage?: any }`
- Errors are surfaced and also emitted via events; middleware decides retries/abort.

## Memory patterns

- Short-lived: use `Context` for per-request/session values (user, correlation id, conversation state pointer).
- Long-lived: a `memory` resource (KV, vector store, DB) with clear lifecycle; expose CRUD via tasks; inject into abilities.
- Tool factories: return functions bound to an internal state (for example, a to‑do list) while remaining DI-managed.
- Testing: override memory with an in-memory double via `override()` in a test harness.

## Planning patterns (safe/public)

- Keep planning explicit and structured. Define a `Plan` type with steps referencing ability ids and tool ids.
- Represent interim reasoning as events/logs or typed `Plan` objects, not opaque freeform text.
- Allow human-in-the-loop by emitting a `plan.created` event; hooks can mutate/approve or stop propagation.

Example plan step:

```ts
interface PlanStep {
  abilityId: string;
  input: unknown;
  toolIds?: string[];
}
interface Plan { steps: PlanStep[]; done?: boolean; notes?: string[] }
```

## Observability & safety

- Debug: set `run(app, { debug: "verbose" })` or attach `globals.tags.debug` to critical components.
- Logging: use `globals.resources.logger`; enrich with `source` and context.
- Errors: handle via `onUnhandledError` and agent-level middleware.
- Cycles: event cycle detection protects against deadlocks during emission.
- Timeouts/retries: use built‑ins; add custom backoff strategies per ability.
- Rate limiting: `Semaphore` around external APIs; reuse `Queue` for serial flows.

## Recommended project layout (generated + hand-written)

```
src/
  agents/
    agents.tags.ts          # agentTag, toolTag, abilityTag definitions
    tools.generated.ts      # tool resources (stubs)
    abilities.generated.ts  # ability tasks (stubs)
    agents.generated.ts     # agent resources + entry tasks (stubs)
    wiring.generated.ts     # ready hook wiring
    index.ts                # re-exports and hand-written additions
  domain/                   # concrete logic filled by devs
  main.ts                   # run(app, options)
```

Keep generated files separate; allow overrides via composition rather than editing generated code.

## Testing strategy

- Create a `harness` resource that registers the agent and overrides external tools.
- Unit test abilities as plain tasks; integration test the agent entry task with a fake memory tool.
- Aim for 100% coverage (enforced); validate event emission order and middleware behavior.

Example (pseudo):

```ts
const harness = resource({ id: "test", register: [app], overrides: [mockMemory] });
const rr = await run(harness);
await rr.runTask("app.agents.support.entry", { message: "Hi" });
await rr.dispose();
```

## Next steps (incremental)

1. Define and export the three tags (`agents.agent`, `agents.tool`, `agents.ability`).
2. Implement a small `wiring.generated.ts` hook using `store` + tags.
3. Draft a tiny spec and a simple Node script in `scripts/generate-from-spec.ts` that emits stubs.
4. Build 1 demo agent with 2 tools and 3 abilities; expose over HTTP using a ready hook (see `AI.md` for route wiring pattern).
5. Add tests and an example spec to validate the pipeline end‑to‑end.

This keeps the surface area small while leveraging Runner’s strengths: DI, events, middleware, tags, and observability.
