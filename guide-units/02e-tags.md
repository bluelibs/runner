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

### System Tags

Built-in tags can affect framework behavior.

```typescript
import { tags, r } from "@bluelibs/runner";

// Assuming `performCleanup` is your own application function.
const internalTask = r
  .task("internalTask")
  .tags([tags.internal, tags.debug.with({ logTaskInput: true })])
  .run(async () => performCleanup())
  .build();

const internalEvent = r
  .event("internalEvent")
  .tags([tags.excludeFromGlobalHooks])
  .build();
```

Tasks can also opt into runtime health gating with `tags.failWhenUnhealthy.with([db, cache])`.

### Contract Tags

Contract tags enforce task or resource typing without changing runtime behavior.

```typescript
import { r } from "@bluelibs/runner";

type InputType = { id: string };
type OutputType = { name: string };

const userContract = r.tag<void, InputType, OutputType>("userContract").build();

const profileTask = r
  .task("getProfile")
  .tags([userContract])
  .run(async (input) => ({ name: input.id + "Ada" }))
  .build();
```

Fail-fast rule: if a tagged item depends on the same tag, Runner throws during store sanity checks.

> **runtime:** "Tags: metadata with a mission. You stick labels on everything, I index them, and at startup someone finally discovers why three tasks share a route prefix. It's like naming your pets—except these ones actually come when called."
