# Architecting With Runner

[Back to main README](../README.md)

Runner works best when you treat it as an architectural compiler, not a bag of helpers.
You declare a graph of resources, tasks, events, hooks, middleware, tags, and errors, then `run(app)` turns that graph into a lifecycle-managed runtime with visibility, validation, and isolation enforced.

This guide is about how to build systems carefully with that model: folder structure, reuse patterns, boundaries, tags, subtree policy, overrides, and team-scale maintenance.

## How to Read This Guide

Use this reading path:

1. Start with the `0 to 1` section if you want the fastest runnable shape.
2. Read the mental model and design principles to understand how Runner wants you to think.
3. Read structure, composition, and decision rules when designing a new feature.
4. Read subtree, isolate, lifecycle, and testing when hardening a system.
5. Use the review checklist, hardening checklist, and common mistakes during PR review.

## 0 to 1: A Runnable Starter Path

If you are new to Runner, start here before reading the rest of the architecture guidance.

Create these three files:

```ts
// src/app/app.resource.ts
import { r } from "@bluelibs/runner";

export const ping = r
  .task("ping")
  .run(async () => "pong")
  .build();

export const app = r
  .resource("app")
  .register([ping])
  .build();
```

```ts
// src/app/register.ts
export { app, ping } from "./app.resource";
```

```ts
// src/app/run.ts
import { run } from "@bluelibs/runner";
import { app, ping } from "./register";

async function main() {
  const runtime = await run(app);
  const result = await runtime.runTask(ping);
  console.log(result); // "pong"
  await runtime.dispose();
}

void main();
```

This is intentionally small, but it already teaches the core story:

- declare definitions first
- compose them under a resource
- start one runtime with `run(app)`
- interact through the runtime API
- shut down cleanly

## The Architectural Mental Model

Think in four layers:

1. Authoring layer: define reusable resources, tasks, events, hooks, middleware, and tags.
2. Composition layer: register those definitions under feature resources and one root app resource.
3. Validation layer: let Runner validate dependency wiring, visibility, and policy before serving work.
4. Runtime layer: `run(app)` starts lifecycle, admissions, health, and shutdown behavior.

That means a healthy Runner app usually has these characteristics:

- definitions are declared as constants
- composition is explicit and readable
- side effects live in `resource.init()`, `resource.ready()`, `task.run()`, and hooks, not in module top-level code
- boundaries are owned by resources, not by naming conventions alone
- cross-cutting behavior is attached through middleware, subtree policy, and tags

A small joke with a serious point: if your architecture depends on everyone remembering the rule, Runner will eventually become your very strict teammate who says no. That is a feature.

## Design Principles

## Decision Matrix: Which Runner Primitive When?

Use this as the quick chooser when designing a feature.

| Use | Choose | When | Avoid |
| --- | --- | --- | --- |
| shared lifecycle-owned capability | `resource` | database clients, stores, providers, ingress, long-lived services | using a resource as a multi-step business workflow |
| one business action or orchestration step | `task` | create order, sync account, calculate quote | putting long-lived infrastructure ownership in a task |
| typed metadata and discovery | `tag` | routes, policy groups, contracts, discovery sets | using tags as execution control flow |
| business signal | `event` | something happened and others may react | using an event when one direct collaborator is already known |
| reaction to an event | `hook` | notifications, projections, audit, integrations | putting the main business invariant only in hooks |
| execution wrapper | `middleware` | retry, timeout, auth, caching, metrics | embedding cross-cutting concerns in every task by hand |
| inherited feature-wide policy | `subtree(...)` | attach middleware, validators, identity policy to a feature boundary | using subtree only as decorative namespacing |
| hard visibility and access boundary | `isolate(...)` | exports, privacy, deny and allow rules | isolating everything by default without a reason |

### Dependency vs Tag vs Event vs Hook

Use this rule of thumb:

- exact known collaborator: direct dependency
- changing set of collaborators: tag dependency
- announce something happened: event
- react in another concern: hook

Common anti-patterns:

- using a tag when you really need one exact dependency
- using an event to hide a required synchronous business dependency
- using a hook to own core business state transitions

### Keep Composition Pure

Use modules to export definitions. Keep boot-time side effects out of import paths.

Good:

- `userStore` resource definition
- `createUser` task definition
- `userCreated` event definition
- `userFeature` resource that registers them

Less good:

- opening sockets at import time
- dynamically mutating global arrays of tasks
- hiding registration inside helper functions with unclear outputs

Example:

```ts
// Bad
const db = createDbClient();
export const createUser = async (input: { email: string }) => db.insert(input);

// Better
import { r } from "@bluelibs/runner";

export const database = r
  .resource("database")
  .init(async () => createDbClient())
  .build();
```

### Prefer Local Ids in Authoring

Use short local ids such as `createUser`, `userStore`, and `sendWelcomeEmail`.
Runner composes canonical ids from ownership at runtime.

Architectural implication:

- write code around definition references, not handcrafted canonical id strings
- treat canonical ids as runtime addresses and diagnostics, not your design API
- never build framework internals around lossy id normalization

### Let Resources Own Boundaries

A resource is more than a singleton. In Runner it is the unit that owns:

- lifecycle
- subtree registration
- visibility boundaries
- reusable domain capabilities
- feature-local policies

If a feature has meaningful ownership, it should usually have a resource that acts as that boundary.

## Recommended Folder Structure

A good default for applications built with Runner:

```text
src/
  app/
    app.resource.ts
    register.ts
    run.ts
  features/
    billing/
      billing.resource.ts
      tasks/
        createInvoice.task.ts
        payInvoice.task.ts
      resources/
        invoiceStore.resource.ts
        paymentGateway.resource.ts
      events/
        invoicePaid.event.ts
      hooks/
        sendReceipt.hook.ts
      middleware/
        requireBillingIdentity.middleware.ts
      tags/
        billingRoute.tag.ts
        billable.tag.ts
      contracts/
        payment.contract.ts
      tests/
        billing.integration.test.ts
        overrides.ts
    users/
      ...
  shared/
    tags/
    middleware/
    contracts/
    utils/
  infra/
    http/
    persistence/
    logging/
    metrics/
  test-overrides/
    fakeMailer.override.ts
    inMemoryDatabase.override.ts
```

Use this as a shape, not a prison.
The goal is clear ownership:

- `app/`: composition root only
- `features/<feature>/`: bounded context definitions
- `shared/`: reusable policies and contracts that are truly cross-feature
- `infra/`: platform and operational resources
- `test-overrides/`: intentional replacement definitions for tests

Recommended ownership contracts:

- `app/` may import features and infra, but should not own business logic
- `features/<feature>/` should expose one clear feature boundary and avoid deep imports into other features
- `shared/` should contain only truly shared contracts, tags, middleware, or utilities
- `infra/` should own environment and platform integration boundaries
- `test-overrides/` should contain replacement definitions, not production logic

For larger teams, add a small contract file per feature such as `features/<feature>/contract.ts` that captures:

- owning team
- exported surface
- stability level
- upgrade notes
- test owners

### What Should Stay Out of `app/`

Keep `app/` thin.
It should mostly:

- import feature resources
- register them
- set top-level subtree or isolation policy when needed
- configure runtime startup

Do not turn `app/` into the place where all business logic goes to retire.

## A Feature-First Composition Pattern

A feature should usually export one feature resource that registers the rest of its surface.
That gives you one obvious architectural unit for reuse and isolation.

```ts
import { r } from "@bluelibs/runner";
import { invoiceStore } from "./resources/invoiceStore.resource";
import { paymentGateway } from "./resources/paymentGateway.resource";
import { createInvoice } from "./tasks/createInvoice.task";
import { payInvoice } from "./tasks/payInvoice.task";
import { sendReceipt } from "./hooks/sendReceipt.hook";

export const billingFeature = r
  .resource("billing")
  .register([
    invoiceStore,
    paymentGateway,
    createInvoice,
    payInvoice,
    sendReceipt,
  ])
  .build();
```

Then the root app composes features:

```ts
import { r } from "@bluelibs/runner";
import { billingFeature } from "../features/billing/billing.resource";
import { usersFeature } from "../features/users/users.resource";

export const app = r
  .resource("app")
  .register([billingFeature, usersFeature])
  .build();
```

Why this scales well:

- each feature owns its internal registration
- features remain importable and testable in isolation
- feature boundaries become the natural place for subtree policy and exports
- app composition reads like architecture, not wiring soup

### A Minimum Viable Composition and Test Shape

This is a good week-one pattern:

```ts
import { run, r } from "@bluelibs/runner";

const greet = r
  .task("greet")
  .run(async (name: string) => `Hello ${name}`)
  .build();

const greetingsFeature = r
  .resource("greetings")
  .register([greet])
  .build();

const app = r
  .resource("app")
  .register([greetingsFeature])
  .build();

const runtime = await run(app);
const result = await runtime.runTask(greet, "Ada");
await runtime.dispose();
```

```ts
expect(result).toBe("Hello Ada");
```

## Reuse Patterns That Age Well

### Reuse Definitions, Not Ad Hoc Helper Output

Prefer exporting built definitions directly.
This keeps references stable and lets Runner validate wiring cleanly.

Good reuse:

- shared tag definitions
- reusable middleware definitions
- reusable base resources for transport, caching, serialization, and stores
- feature resources that can be registered under different apps

Less good reuse:

- helper functions that create fresh anonymous definitions on every call without need
- hidden registration through complex builder factories when a plain exported constant would do

### Put Environmental Concerns Behind Resources

External systems should usually be represented by resources:

- databases
- HTTP clients
- queue producers and consumers
- serializers
- loggers
- metrics sinks
- configuration-backed providers

That keeps tasks deterministic and easier to test.
Tasks should mostly coordinate business intent, not construct infrastructure.

### Prefer Direct Dependencies for Known Collaborators

Use a direct dependency when one component knows exactly what it needs.
Use a tag dependency when you want typed discovery over a changing set.

A useful rule:

- exact collaborator: dependency
- open set of collaborators: tag

### Dependency Graph Rules for Long-Lived Systems

Keep these rules explicit:

- prefer public feature surfaces over deep cross-feature imports
- do not couple feature A to feature B internals when feature B should export a task, event, or resource boundary
- if a dependency cycle appears, break it with one of:
  - a shared contract resource
  - an event and hook seam
  - a tag-driven discovery surface
  - a new feature boundary that owns the shared concept

## Tags as Architectural Contracts

Tags are not decorative labels.
In Runner they are part of the discovery and policy system.
They can:

- attach schema-validated metadata
- restrict allowed targets with `.for(...)`
- support discovery through tag accessors in dependencies
- enforce compile-time contracts on inputs and outputs
- influence framework behavior

### Build a Small Tag Vocabulary

Create a small number of well-named tags and reuse them consistently.
Examples:

- route tags
- feature ownership tags
- contract tags
- observability tags
- security or exposure tags
- lifecycle grouping tags

A good pattern is to keep tags near the feature that owns the meaning:

```text
features/billing/tags/
  billingRoute.tag.ts
  requiresAccountManager.tag.ts
  invoiceProjection.tag.ts
```

For larger teams, add lightweight tag governance:

- namespace shared tags clearly, for example `billing:*` or `users:*`
- document the owner of each shared tag
- define schema compatibility expectations before changing shared tag config
- deprecate tags deliberately instead of silently changing their meaning

### Use `.for(...)` to Keep Tags Honest

If a tag should only apply to tasks, say so.
If it is meant for resources and tasks, say so.
This gives you fail-fast validation when someone attaches it to the wrong kind of definition.

### Use Tags for Discovery, Not Guesswork

Tag dependencies give you typed access to matching definitions.
That is powerful for:

- route auto-registration
- startup registration
- health groups
- projection handlers
- feature-local discovery without hardcoding every collaborator

### Use Contract Tags for Shared Interfaces

When several resources or tasks must honor the same input or output contract, tags can express that contract once and enforce it at compile time.
That is cleaner than repeating comments like `must return { id, title }` across half the codebase.

Example:

```ts
import { r } from "@bluelibs/runner";

const invoiceRoute = r
  .tag<{ method: "GET" | "POST"; path: string }>("invoiceRoute")
  .for(["tasks"])
  .build();

const createInvoice = r
  .task("createInvoice")
  .tags([invoiceRoute.with({ method: "POST", path: "/invoices" })])
  .run(async () => ({ ok: true }))
  .build();
```

## Middleware Layering Rules

Middleware is where cross-cutting policy should live.
That includes things like:

- auth and identity checks
- timeouts
- retries
- rate limits
- caching
- tracing
- logging
- metrics

### Keep Middleware Modules Reusable

Prefer named middleware definitions in modules over inline lambdas inside task declarations.
That makes policy reusable, testable, and reviewable.

### Separate Global Policy From Feature Policy

A good layering model:

- global middleware: tracing, correlation, retries, logging, timeout defaults
- feature middleware: billing-specific permissions, idempotency keys, domain guards
- subtree policy: automatic attachment of shared behavior to everything inside a feature boundary

### Be Deliberate About Ordering

Earlier middleware wraps later middleware.
That means ordering changes behavior.
For example:

- timeout outside retry means the whole retry process is budgeted
- retry outside timeout means each attempt gets its own timeout
- caching outside auth can be a security bug in a nice outfit

If the order matters, make it explicit and keep it stable.

## Failure, Resilience, and Idempotency

Serious Runner systems need explicit failure design.
Do not leave it to whichever middleware someone remembers to add last.

### Design Error Taxonomy Early

At minimum, separate:

- user or contract errors
- transient infrastructure errors
- fatal infrastructure errors
- compensatable business failures

That choice influences:

- whether retry makes sense
- whether fallback is safe
- whether the event or task should fail fast
- whether operators need a DLQ or manual intervention path

### Make Idempotency a Design Choice

For tasks and event reactions that can be retried or replayed, define:

- the idempotency key
- duplicate suppression strategy
- whether side effects are safe to repeat
- what state proves the work already happened

Good examples:

- `createInvoice` keyed by external request id
- `sendReceipt` guarded by stored delivery state
- projection hooks that can safely re-apply the same event

### Treat Hooks as Side-Effect Boundaries

Hooks are often where retries and duplicates become visible.
If a hook sends email, publishes to another system, or writes to a projection, document whether it is:

- safe to retry
- safe to reorder
- safe to run more than once

If the answer is no, build the idempotency strategy before production teaches the lesson the expensive way.

## Events and Hooks as Integration Seams

Events and hooks are excellent for decoupling, but they work best when they stay small and intentional.

Use hooks for:

- side effects after a domain action
- integration reactions
- notifications
- projections
- audit trails

Try not to move core business invariants entirely into distant hooks unless eventual consistency is actually what you want.

A practical split:

- task: owns the business action
- event: announces that it happened
- hook: reacts in another concern

### Keep Hooks Small

A hook should usually do one thing clearly.
If a hook grows large, make it depend on a task/resource that owns the behavior.

### Control Global Behavior With Tags

If certain events or hooks should be excluded from broad listeners or framework-wide reactions, use tags rather than naming conventions.
That keeps the rule declarative and reviewable.

Anti-pattern:

- if a business action is only understandable by following one task and five hooks, the primary action is too fragmented
- move the core invariant back into the task or a feature-owned resource

## Subtree Policy and Isolation

This is one of the strongest architectural features in Runner.
Use it.

### `subtree(...)` Is for Inherited Feature Policy

Subtree policy lets a resource apply policy to everything registered under it.
That is a strong fit for:

- auto-applied middleware to tasks and resources inside a feature
- subtree validation
- identity policy for all tasks in a bounded context

This makes feature boundaries do real architectural work.

### `isolate(...)` Is for Visibility and Access Boundaries

Think of `isolate(...)` as boundary control.
It helps you decide:

- what the subtree exports
- what stays private
- what access patterns are denied or allowed

A strong default is a closed-by-default mindset for feature internals.
Expose only the capabilities meant to be used from the outside.

Examples of good use:

- export only public tasks from a feature resource
- keep internal tasks and events private
- hide helper resources behind the feature resource
- filter tag-based discovery by visibility instead of trusting team discipline alone

### `subtree(...)` vs `isolate(...)` vs Plain Composition

Use this rule:

- plain composition: when you only need readable registration and no inherited policy
- `subtree(...)`: when the boundary should apply inherited middleware, validation, or identity policy
- `isolate(...)`: when the boundary should restrict visibility or define a public surface

Red flags:

- using `subtree(...)` only to imply privacy
- using `isolate(...)` everywhere without a public-surface reason
- assuming `subtreeOf(...)` is the same thing as API visibility

### Boundary Precedence and Visibility Matrix

Keep this model in mind:

1. ownership and subtree policy determine what inherited policy applies
2. isolation determines what may be seen or crossed
3. exports determine what counts as public surface to outside callers
4. tag discovery is still filtered by visibility

That means:

- a definition can match a tag and still remain invisible outside the boundary
- a parent subtree can contribute inherited policy while a child boundary still limits visibility through `isolate(...)`
- runtime access through `runTask`, `emitEvent`, and resource getters is still checked against root access policy

### What Export Means

Treat exports as feature API, not as a convenience list.

Practical guidance:

- export tasks and events that are intended for outside collaboration
- keep helper resources, internal tasks, and internal events private unless they are truly part of the public contract
- document exported capabilities in the owning feature contract
- use deprecation and migration notes when changing exported surfaces

### Treat Exports as Architectural API

If a task or event is exported, you are effectively making it part of the feature public contract.
Be intentional.

That means exported surfaces should usually be:

- stable
- named well
- documented enough to be reused safely
- small

Also define:

- who owns the contract
- what counts as a breaking change
- how long deprecations remain supported
- which tests prove the public surface still works

### Public Surface Tests

For every meaningful feature boundary, add tests that prove:

- intended exports are reachable
- private internals are not reachable
- tag discovery does not leak hidden definitions
- overrides do not accidentally change the public surface

## Lifecycle-Aware Design

Runner has a real runtime lifecycle.
Design with it in mind.

### Use `init()` for Creation

`resource.init()` should create the resource value and establish dependencies needed for operation.
Avoid starting ingress there when early work would race the rest of bootstrap.

### Use `ready()` for Starting Intake

If a resource begins accepting external work, `ready()` is usually the safer place.
That way the system is fully wired before requests, jobs, or messages start arriving.

Typical `ready()` candidates:

- HTTP servers
- queue consumers
- message subscriptions
- schedulers

### Use `cooldown()` to Stop Intake Quickly

`cooldown()` is for shutting the front door, not for doing all cleanup.
Stop new admissions there, then let drain and `dispose()` finish the rest.

### Use `dispose()` for Teardown

Dispose long-lived dependencies in reverse-safe order through resource disposal.
That is where connections, timers, workers, and clients should usually be closed.

### State Timeline and Rejection Boundaries

The simplified runtime timeline is:

1. dependency wiring and validation
2. resource `init()`
3. resource `ready()`
4. runtime is ready for normal work
5. `cooldown()` stops intake
6. drain and shutdown sequencing
7. `dispose()` teardown

Architecturally important boundaries:

- startup validation happens before normal work
- `ready()` is the safer place for ingress
- lazy resource wakeup is for startup-idle resources, not shutdown-time surprises
- once shutdown progresses, external work and lazy wakeups can be rejected

### Lazy Resource Guidance

Use `getLazyResourceValue(...)` only for resources that are intentionally idle at startup and safe to initialize on demand.
Do not build core request paths that depend on waking arbitrary resources during shutdown or late disposal phases.

## Testing and Overrides

Runner is designed for controlled replacement.
Use that instead of mutating original definitions.

### Prefer `r.override(...)` for Behavior Replacement

Overrides let you preserve ids while swapping behavior.
That is perfect for tests and for infrastructure substitution.
Remember that `r.override(...)` creates a replacement definition. Apply it through app composition, usually with `.overrides([...])` on the resource that owns the test or runtime composition.

Override contract notes:

- task, hook, task middleware, and resource middleware overrides replace behavior with functions
- resource overrides may replace `init` or patch lifecycle with `{ context?, init?, ready?, cooldown?, dispose? }`
- keep overrides close to the owning composition where possible
- document precedence when multiple layers may apply overrides

Typical examples:

- replace a real mailer with an in-memory mailer
- replace a database resource with an in-memory store
- replace a transport middleware with a test spy

### Keep Override Modules Explicit

Put them in a place where the team can find them quickly:

```text
test-overrides/
features/<feature>/tests/overrides.ts
```

### Test at the Feature Boundary

Good Runner tests often:

- compose a small app or feature resource
- apply a few focused overrides
- run the runtime
- call tasks or emit events
- assert outputs, side effects, and boundary behavior

Also test the boundaries themselves:

- visibility rules
- exported surface only
- optional dependencies resolving to `undefined`
- tag discovery behavior
- middleware ordering assumptions

### A Testing Pyramid for Runner

Use three tiers:

1. definition-level tests
   - small builder and policy tests
   - subtree and isolate declarations
   - tag target and contract tests
2. feature composition tests
   - one feature root
   - a few focused overrides
   - task calls and event flows
3. full runtime integration tests
   - full app run and dispose cycle
   - lifecycle, health, and boundary behavior under realistic composition

### A Reusable Test Composition Pattern

```ts
import { run } from "@bluelibs/runner";
import { app } from "../src/app/register";
import { fakeMailer } from "../test-overrides/fakeMailer.override";

export async function buildTestApp() {
  const testApp = app.with(undefined);
  const runtime = await run(testApp, {
    mode: "test",
  });

  return {
    runtime,
    async dispose() {
      await runtime.dispose();
    },
  };
}
```

Even if your real helper is different, the pattern matters:

- centralize default overrides
- centralize runtime creation
- centralize teardown
- assert public surface and lifecycle behavior in one predictable place

### Override Anti-Patterns

Avoid:

- mutating original definitions instead of replacing them
- overriding behavior while accidentally changing the intended public surface
- stacking overrides with unclear precedence
- overriding internal resources that should stay private by policy
- forgetting to test shutdown behavior after adding ingress resources

### Hardening Checklist for PRs

Before merging feature architecture changes, check:

1. public exports are intentional and minimal
2. deep cross-feature imports are avoided
3. subtree and isolate rules are tested where they matter
4. middleware order is explicit
5. overrides are attached at the correct composition layer
6. tag names and schemas follow ownership rules
7. platform-specific code stays behind resources and folder boundaries
8. lifecycle-sensitive resources prove startup and shutdown behavior

## Multi-Platform Boundaries

Runner is multi-platform, and the framework itself keeps Node-specific features under `src/node/`.
Applications built on Runner should keep the same discipline.

A good rule:

- domain logic stays platform-neutral
- platform integration sits behind resources
- Node-only behavior lives in clearly named Node-only modules

Examples:

- browser-safe domain feature in shared feature modules
- Node-only queue consumer resource in `infra/node/`
- platform-specific registration decided in the app composition root

That keeps the rest of the system portable and easier to evolve.

## Team-Scale Governance

For larger systems, architecture quality depends on ownership as much as on code shape.

Recommended additions:

- a small ownership contract per feature
- a shared tag registry with namespace rules
- deprecation rules for exported surfaces and shared tags
- PR review gates for dependency direction and public surface growth

Useful prompts for teams:

- who owns this exported surface
- who may depend on it
- what is the migration path if it changes
- what tests prove it remains compatible

## Review Checklist for Runner Architecture

Use this when reviewing a feature or refactor:

1. Does the feature have a clear owning resource boundary?
2. Are tasks focused on business actions rather than infrastructure setup?
3. Are external systems represented as resources?
4. Are tags reused as stable architectural vocabulary rather than ad-hoc metadata?
5. Is middleware ordered intentionally?
6. Are hooks small and used as integration seams rather than dumping grounds?
7. Is subtree policy used where feature-wide policy should be inherited?
8. Is the exported surface of each feature intentionally small?
9. Are tests using overrides instead of mutating definitions?
10. Are platform-specific concerns isolated behind resources and folder boundaries?

## First Failures You Will See

These are common early mistakes and what they usually mean:

- missing dependency resolution
  - the dependency is not registered in the owning feature or app composition
- tag `.for(...)` mismatch
  - the tag was attached to the wrong definition kind
- unexpected visibility failure
  - the definition exists, but a subtree boundary or root export policy hides it
- override does not seem to apply
  - the replacement was created but not attached through composition
- lifecycle surprise at shutdown
  - ingress started too early or cleanup logic lives in the wrong lifecycle hook

## Common Architectural Mistakes

### A Giant Root App Resource

If `app` directly registers everything and owns all policy, feature boundaries become social conventions instead of technical ones.
Prefer feature resources.

### Treating Tags Like Labels Only

If tags never drive discovery, contracts, or policy, they will drift into decorative metadata.
Use them where they provide real leverage.

### Putting Business Logic Into Hooks First

Hooks are great, but if the core action is only understandable by reading five reactions across the tree, debugging gets sporty in the wrong way.
Keep the primary action in tasks or resources.

### Leaking Internals Through Exports

If every internal task is exported, the subtree boundary is not really a boundary anymore.
Export the minimum useful surface.

### Testing Through Mutation Instead of Replacement

Do not mutate definitions for tests.
Use overrides and build the test composition explicitly.

Build feature resources that own clear boundaries, export small public surfaces, attach policy declaratively, and let Runner enforce the architecture you meant to have.
