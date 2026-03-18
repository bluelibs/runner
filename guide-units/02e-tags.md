## Tags

Tags are Runner's typed discovery system. They attach metadata to definitions, influence framework behavior, and can be consumed as dependencies to discover matching definitions at runtime.

```typescript
import { Match, r } from "@bluelibs/runner";

const httpRoute = r
  .tag("httpRoute")
  .for(["tasks"])
  .configSchema(
    Match.compile({
      method: Match.OneOf("GET", "POST"),
      path: Match.NonEmptyString,
    }),
  )
  .build();

const getHealth = r
  .task("getHealth")
  .tags([httpRoute.with({ method: "GET", path: "/health" })])
  .run(async () => ({ ok: true }))
  .build();

// Tags and definitions using them must be registered in a resource.
const app = r.resource("app").register([httpRoute, getHealth]).build();
```

**What you just learned**: Tags attach typed, schema-validated metadata to definitions. They turn runtime discovery from guesswork into a typed query.

- auto-discovery such as HTTP route registration
- scheduling and startup registration
- cache warmers or policy grouping
- access-control or monitoring metadata
- framework behaviors such as global hook exclusion or health gating

### Scoped Tags

Use `.for(...)` to restrict where a tag can be attached.

- `.for("tasks")` for a single target
- `.for(["tasks", "resources"])` for multiple targets

Accepted targets:

- `"tasks"`
- `"resources"`
- `"events"`
- `"hooks"`
- `"taskMiddlewares"`
- `"resourceMiddlewares"`
- `"errors"`

### Tag Composition Behavior

Repeated `.tags()` calls append by default. Use `{ override: true }` to replace the existing list.

```typescript
import { r } from "@bluelibs/runner";

const apiTag = r.tag("apiTag").build();
const cacheableTag = r.tag("cacheableTag").build();
const internalTag = r.tag("internalTag").build();

const taskWithTags = r
  .task("taskWithTags")
  .tags([apiTag])
  .tags([cacheableTag])
  .tags([internalTag], { override: true })
  .run(async () => "ok")
  .build();
```

### Discovering Components by Tags

Depending on a tag injects a typed accessor over matching definitions.

```typescript
import { events, r } from "@bluelibs/runner";

// Assuming: expressServer is a resource exposing an Express-like { app } instance.
const routeRegistration = r
  .hook("routeRegistration")
  .on(events.ready)
  .dependencies({
    server: expressServer,
    httpRoute,
  })
  .run(async (_event, { server, httpRoute }) => {
    httpRoute.tasks.forEach((entry) => {
      const config = entry.config;
      if (!config) {
        return;
      }

      server.app[config.method.toLowerCase()](config.path, async (req, res) => {
        const result = await entry.run({ ...req.params, ...req.body });
        res.json(result);
      });
    });
  })
  .build();
```

Accessor categories:

- `tasks`
- `resources`
- `events`
- `hooks`
- `taskMiddlewares`
- `resourceMiddlewares`
- `errors`

### Runtime Helpers on Tag Matches

Tag matches are not just metadata snapshots.

- `tasks[]` entries expose `definition`, `config`, and runtime `run(...)`
- `tasks[].intercept(...)` is available in resource dependency context
- `resources[]` entries expose `definition`, `config`, and runtime `value`

Use `tag.startup()` when startup ordering matters: wrapping a tag with `.startup()` in `dependencies` ensures the tag accessor is ready during bootstrap before the resource dependency graph runs, rather than resolving during normal dependency resolution.

### When to Use Tags

Use tags when you want discovery or policy over a changing set of definitions:

- route registration
- startup auto-registration
- policy groups such as health gating or internal-only components
- framework extensions that should discover tasks/resources without direct references

Prefer direct dependencies when one component already knows the exact collaborator it needs.

### Tag Extraction and Processing

Tags can also be queried directly against definitions.

```typescript
import { r } from "@bluelibs/runner";

const performanceTag = r.tag<{ warnAboveMs: number }>("performanceTag").build();

const performanceMiddleware = r.middleware
  .task("performanceMiddleware")
  .run(async ({ task, next }) => {
    if (!performanceTag.exists(task.definition)) {
      return next(task.input);
    }

    const config = performanceTag.extract(task.definition)!;
    const startTime = Date.now();
    const result = await next(task.input);
    const duration = Date.now() - startTime;

    if (duration > config.warnAboveMs) {
      console.warn(`Task ${task.definition.id} took ${duration}ms`);
    }

    return result;
  })
  .build();
```

### Built-in Tags

Built-in tags can affect framework behavior.

```typescript
import { tags, r } from "@bluelibs/runner";

// Assuming `performCleanup` is your own application function.
const observedTask = r
  .task("observedTask")
  .tags([tags.debug.with("verbose")])
  .run(async () => performCleanup())
  .build();

const internalEvent = r
  .event("internalEvent")
  .tags([tags.excludeFromGlobalHooks])
  .build();
```

Tasks can also opt into runtime health gating with `tags.failWhenUnhealthy.with([db, cache])`.

### Contract Tags

Contract tags enforce input/output typing on any task or resource using them at compile time, without changing runtime behavior.

A tag can declare:

- **Input Contract**: any task using it must accept at least the specified input properties
- **Output Contract**: any task using it must return at least the specified output properties

```typescript
import { r } from "@bluelibs/runner";

// r.tag<Config, InputContract, OutputContract>
const authorizedTag = r
  .tag<void, { userId: string }, void>("authorizedTag")
  .build();

// Works: task input is a superset of the contract
const validTask = r
  .task("dashboard")
  .tags([authorizedTag])
  .run(async (input: { userId: string; view: "full" | "mini" }) => {
    return { data: "..." };
  })
  .build();

// Compile error: task input is missing userId
const invalidTask = r
  .task("publicDashboard")
  .tags([authorizedTag])
  // @ts-expect-error - input doesn't satisfy contract { userId: string }
  .run(async (input: { view: "full" }) => {
    return { data: "..." };
  })
  .build();
```

Output contracts work the same way:

```typescript
const searchableTag = r
  .tag<void, void, { id: string; title: string }>("searchableTag")
  .build();

const productTask = r
  .task("getProduct")
  .tags([searchableTag])
  .run(async (id: string) => ({
    id,
    title: "Super Gadget",
    price: 99.99, // extra fields are fine
  }))
  .build();
```

For **Resources**, contracts map to the resource shape:

- **Input Contract** → enforced on the **resource configuration** (passed to `.with()` and `init`)
- **Output Contract** → enforced on the **resource value** (returned from `init`)

```typescript
const databaseTag = r
  .tag<
    void,
    { connectionString: string },
    { connect(): Promise<void> }
  >("databaseTag")
  .build();

const validDb = r
  .resource("database")
  .tags([databaseTag])
  .init(async (config) => ({
    async connect() {
      /* ... */
    },
  }))
  .build();
```

If you use `.inputSchema` or `.resultSchema`, their shapes must be supersets of any contract tag contracts.

Fail-fast rule: if a tagged item depends on the same tag, Runner throws during store sanity checks.
