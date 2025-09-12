# Tunnels (Task and Event Routing)

Tunnels let you route selected tasks and/or events through your own transport or execution layer. They are driven by a configurable tag (`globals.tags.tunnel`) and a global resource middleware that applies overrides or interceptors based on the tag.

This is useful for:

- Client/Server bridging (execute tasks on a remote runtime)
- Cross‑process or cross‑tab routing
- Feature‑flagged detours for specific tasks/events

The feature is zero‑touch for call‑sites: you keep calling tasks or emitting events the same way; the tunnel layer intercepts/overrides under the hood.

## TL;DR

- Tag a resource with `globals.tags.tunnel.with({ ... })` and return a runner object from its `init()`.
- If you configure `tasks`, implement `run(task, input)` on the returned value.
- If you configure `events`, implement `emit(emission)` on the returned value.
- Mode controls whether patching happens locally (`client`) or is deferred (`server`/`none`).

Task‑level middleware policy (optional, whitelist):

- Tag tasks with `globals.tags.tunnelPolicy.with({ client: [mwId1, mwDef2], server: [...] })` to control which middlewares run on caller vs executor when tunneled.
- Defaults remain “both” (no filtering) if the tag is not present.

## API

Tag: `globals.tags.tunnel`

Configuration shape:

```ts
type TunnelMode = "client" | "server" | "none"; // default: "none"

interface TunnelTagConfig {
  mode?: TunnelMode;
  tasks?: Array<string | ITask> | ((task: ITask) => boolean);
  events?: Array<string | IEvent> | ((event: IEvent) => boolean);
}

// What your resource's init() must return depending on config
interface TunnelRunner {
  // Required when `tasks` is configured
  run?: (
    task: ITask<any, any, any, any, any, any>,
    input?: any,
  ) => Promise<any>;
  // Required when `events` is configured
  emit?: (emission: IEventEmission<any>) => Promise<any>;
}
```

Runtime rules (enforced by middleware):

- When `tasks` is present, `runner.run` must be a function; otherwise an error is thrown.
- When `events` is present, `runner.emit` must be a function; otherwise an error is thrown.

Mode:

- `client`: applies the overrides and interceptors immediately (local process)
- `server` or `none`: does not override locally (you can use the same config to patch on the client later)

## How It Works

When the tunnel‑tagged resource is initialized, a global middleware:

- Resolves selected tasks (by ids, definitions, or predicate) and overrides their `run()` to call `runner.run(taskDef, input)`.
- Resolves selected events and installs an emission interceptor; matching emissions are forwarded to `runner.emit(emission)` and do not reach normal listeners.

Important:

- Task input/result validation and middleware still run. Even though we replace `task.run`, the runner execution is still composed by the framework, so `inputSchema`, `resultSchema`, and task middleware are preserved.
- If you attach `globals.tags.tunnelPolicy`, it acts as a whitelist per side. On the caller side (client), only the listed middlewares run locally when the task is tunneled. The executor side can apply the same contract if it is Runner‑based.
- The order of initialization matters only to ensure the tunnel resource initializes before the first call of a targeted task. In normal usage, registering the tunnel resource alongside tasks is sufficient.

## Examples

### 1) Tunneling a subset of tasks (by ids)

```ts
import { resource, task, globals, run } from "@bluelibs/runner";

const getUser = task<{ id: string }, Promise<{ id: string }>>({
  id: "app.tasks.getUser",
  run: async ({ id }) => ({ id }),
});

const tunnel = resource({
  id: "app.resources.tunnel",
  tags: [globals.tags.tunnel.with({ mode: "client", tasks: [getUser.id] })],
  init: async () => ({
    run: async (t, input) =>
      fetch(`/api/${t.id}`, {
        method: "POST",
        body: JSON.stringify(input),
      }).then((r) => r.json()),
  }),
});

const app = resource({
  id: "app",
  register: [getUser, tunnel],
  dependencies: { getUser },
  init: async (_, { getUser }) => getUser({ id: "42" }),
});

await run(app);
```

### 2) Tunneling by predicate (function selector)

```ts
const tunnel = resource({
  id: "app.resources.tunnel.fn",
  tags: [
    globals.tags.tunnel.with({
      mode: "client",
      tasks: (t) => t.id.startsWith("app.tasks."),
    }),
  ],
  init: async () => ({ run: async (t, input) => proxyCall(t.id, input) }),
});
```

### 3) Event tunneling (ids)

```ts
import { event, hook } from "@bluelibs/runner";

const userCreated = event<{ id: string }>({ id: "app.events.userCreated" });

// Normal listener — will be called locally as well
const audit = hook({
  id: "app.hooks.audit",
  on: userCreated,
  run: async () => {},
});

const tunnel = resource({
  id: "app.resources.tunnel.events",
  tags: [
    globals.tags.tunnel.with({ mode: "client", events: [userCreated.id] }),
  ],
  init: async () => ({
    // Emissions are delivered both locally and remotely
    emit: async (emission) => sendToBroker(emission),
  }),
});
```

### 4) Event tunneling (function or object definitions)

```ts
// function selector
globals.tags.tunnel.with({
  mode: "client",
  events: (e) => e.id.endsWith(".notify"),
});

// object definitions
globals.tags.tunnel.with({ mode: "client", events: [userCreated] });
```

### 5) Phantom tasks (optional pattern)

You can define placeholder “phantom” tasks to be always routed by the tunnel:

```ts
import { task } from "@bluelibs/runner";

// Emits a no‑op run by default; ideal to be tunneled
const remoteAction = task.phantom<{ input: any }, Promise<any>>({
  id: "app.tasks.remoteAction",
});

// Tunnel will route calls to remoteAction via runner.run(task, input)
```

## Error Handling and Edge Cases

- Selecting a missing task id throws: `Task <id> not found while trying to resolve tasks for tunnel.`
- Selecting a missing event id throws: `Event <id> not found while trying to resolve events for tunnel.`
- Providing `tasks` without `runner.run` or `events` without `runner.emit` throws immediately during init.
- Multiple tunnels can target the same task/event. The last applied override/interceptor wins (based on registration order).
- Middleware policy is a whitelist. If `client` is provided but empty, no local middlewares run when tunneled. If the tag is absent, all applicable middlewares run (default: both sides).

## Tips & Patterns

- SSR/client split:
  - On the server, tag the tunnel with `mode: "server"` or omit `mode` to avoid patching locally.
  - On the client, reuse the same tunnel resource config but with `mode: "client"`.
- Observability:
  - Event tunneling uses an emission interceptor; tunneled emissions are delivered both locally and remotely.
  - Coexistence with middleware:
  - Task middleware and validation still apply around the tunneled run.
  - For granular control, use `globals.tags.tunnelPolicy` to explicitly whitelist which middlewares run on the caller and/or the executor.

## Reference: Implementation Notes

- The global middleware (`globals.middleware.resource.tunnel`) activates for resources tagged with `globals.tags.tunnel`.
- Tasks are overridden by replacing `task.run` with a delegating function to `runner.run(taskDef, input)`.
- Events are tunneled by installing an `eventManager.intercept()` handler that forwards matching emissions to `runner.emit(emission)`.
- Patching occurs during the tagged resource’s `init()` phase (when `mode === "client"`).

---

If you need a condensed checklist:

- Tag a resource with `globals.tags.tunnel.with({ mode: "client", tasks: [...], events: [...] })`.
- Return `{ run, emit }` from its `init()` (only the parts you configure).
- Ensure registration order initializes the tunnel before first use.
- Expect normal validations and middleware to remain in effect for tasks.
