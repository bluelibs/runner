# Runner Architecture & Agent Guidelines

> **Self-Updating Rule**: If you (an AI agent) read this document, ensure you update any changes to reflect the current state of the architecture and **always keep it minimal**.

## App Architecture Guidelines

Runner is a strongly typed application composition framework built around explicit contracts. It operates as a graph of definitions rather than a set of loosely connected modules.

- **Explicit Contracts**: Architecture is enforced at runtime. Dependency injection is explicit and validation is first-class.
- **Composition**: The runtime is composed of definitions (Resources, Tasks, Events, Hooks, Middleware).
- **Lifecycle**: Strict startup and shutdown phases. Startup (`init` -> `ready`) executes in forward dependency order. Shutdown (`cooldown` -> `dispose`) executes in reverse dependency order.
- **Fail-Fast**: The framework enforces boundary, schema, and dependency cycle validation immediately upon initialization.
- **Platform Agnostic**: Multi-platform support is embedded in the core design via platform adapters (`node`, `browser`, `universal`). Node-specific features (Async Context, Durable Workflows) are strictly isolated.
- **Isolation Boundaries**: Nested resources create strict ownership boundaries (e.g., `billing.tasks.charge`). Tests run in highly isolated environments to prevent state bleeding.
- **Fluent Builders**: Builders (e.g., `r.task()`, `r.resource()`) use immutable generic state chaining to yield strictly typed definition objects on `.build()`.
- **Runtime Admission Controller**: Features native `pause()`, `resume()`, and `recoverWhen()` to halt ingress dynamically while allowing active executions to drain.

## Repository & Folder Structure

- `/src/`: Core universal code that limits environmental dependencies to a strict abstraction boundary (`IPlatformAdapter`). It can successfully run in browsers, edge workers, and Node environments.
  - `/src/definers/`: Developer experience boundaries. Houses the `r.*` fluent builders (e.g., `defineTask.ts`, `defineResource.ts`, `defineEvent.ts`). Contains the complex generic accumulation logic that yields definition objects (`.build()`).
    - `/src/definers/builders/`: Modular fluent builder state chains. Contains subdirectories (`task/`, `resource/`, `event/`) split into `.interface.ts` (API contract), `fluent-builder.ts` (immutable state machine logic), and merge configurations designed to ensure type safety.
  - `/src/models/`: The internal engine and execution behaviors.
    - `/src/models/middleware/`: Composes "onion-style" layers (`TaskMiddlewareComposer`, `ResourceMiddlewareComposer`, interceptors) _before_ executions.
    - `/src/models/event/`: The `EmissionExecutor` and `ListenerRegistry` that handles sequential/parallel routing, reporting batches, and complex transaction rollbacks _during_ runtime.
    - `/src/models/runtime/`: Contains the `LifecycleAdmissionController` (phase states: Running -> Paused -> CoolingDown -> Discarding) and `RuntimeRecoveryController` logic.
    - `/src/models/dependency-processor/`: The graph topologically resolving topological DAGs.
    - `/src/models/store/store-registry/`: Tag aggregators and internal flat map access mechanisms indexing definition schemas.
    - `ExecutionContextStore.ts`: Context tracing and causal chain storage.
  - `/src/types/`: Centralized contract repositories defining `IResourceDefinition`, `ITaskDefinition`, symbol identities, and complex Type-level generic restrictions.
  - `/src/globals/`: Built-in native primitives available out of the box. Separated into `middleware/` (cache, circuitBreaker, etc.), `resources/` (eventManager, logger, store, etc.), and standalone `cron/`. Exposed via unified root files `globalMiddleware.ts` and `globalResources.ts`.
  - `/src/platform/adapters/`: Runtime-specific handlers yielding standard `IPlatformAdapter` behaviors. Build-time toggling (`__TARGET__`) sets standard process vs DOM lifecycles (`node.ts`, `browser.ts`, `edge.ts`, and fallback `universal-generic.ts`).
  - `/src/node/`: **Strictly Node-only code.** Houses deep backend functionalities:
    - `/src/node/durable/`: Split natively between `core/` (engine orchestrator), `store/` (state persistence for memory vs redis), `bus/` (pub-sub coordination), and `queue/` (execution limits distribution).
    - `/src/node/rpc-lanes/` & `/src/node/event-lanes/`: Network layer isolation resolving topology bindings parsing configuration against networking implementations (e.g., Network Transports vs RabbitMQ queues or transparent proxying).
    - `/src/node/exposure/`: Full independent external HTTP stack (`exposureServer.ts`, `router.ts`, `requestHandlers.ts`) for mapping runtime task ingress controls logic safely via JSON/Multipart body limits.
  - `/src/__tests__/`: Core isolation boundaries mirroring the main module paths. All tests ensure 100% rigid code coverage. Look here for examples of any architecture mechanism.
- `/readmes/` and `/guide-units/`: Source repositories for the dynamic modular documentation which compiles directly into full markdown files. Note: `FULL_GUIDE.md` is an auto-generated artifact—do not edit manually.

## Inner Processing Architecture

- **Task Execution Pipeline (Onion Model)**: Tasks execute through a dynamically composed middleware chain handled by `TaskMiddlewareComposer`. The layers resolve from outermost to innermost: Global Middleware → Resource Middleware → Local Task Middleware → Validation Phase (`ValidationHelper`) → Task `.run()`.
- **Dependency Map Resolution**: Topologically sorted during container boot. Evaluated lazily or eagerly depending on the config. Cyclic dependencies trigger fail-fast validation prior to ingress opening.
- **Event Emission & Rollbacks**: `EventManager` handles hook batches. It executes same-priority hooks concurrently (if `.parallel(true)`). For `.transactional(true)` events, it enforces sequential execution and automatically invokes returned async undo closures in reverse order upon failure.
- **Context Storage & Tracing (`AsyncLocalStorage`)**: In Node.js environments, `ExecutionContextStore` automatically propagates runtime contexts across async boundaries. This tracks the execution frame stack, handles correlation IDs, and allows the `ExecutionJournal` to remain transparently available without polluting dependency signatures.
- **Metadata & Global Store**: The framework compiles the entire tree of definitions into a flattened internal registry (`Store`). Lineage-aware IDs (canonical IDs) are constructed dynamically by inspecting resource parenting.
- **Platform Adapters Interface**: Core logic abstracts runtime interactions (e.g., timers, event listeners, process environments) behind an `IPlatformAdapter`. It dynamically swaps implementations (`node.ts`, `browser.ts`, `universal.ts`) at build time to maintain universal core integrity while leveraging deep Node primitives where applicable.

## Glossary of Terms

- **Resource**: A singleton object with a defined lifecycle (`init`, `ready`, `cooldown`, `dispose`). It models shared services, state, and acts as the main composition unit.
- **Task**: A typed business action with support for Dependency Injection (DI), middleware chains, and input/output validation (`ValidationHelper`).
- **Event**: A typed signal for decoupling producers from listeners. Supports fail-fast or aggregate error collection.
- **Hook**: A reaction/listener to an Event. Supports execution priority (`order`), concurrent execution (`parallel`), and reversible flows (`transactional`).
- **Middleware**: A wrapper around a Task or Resource used to enforce cross-cutting concerns. Built-ins include caching, rate-limiting, and resilience (circuit-breaking, retries).
- **Tag**: Metadata (`ITag`) attached to definitions for framework-wide discovery and policy enforcement.
- **Error**: A dynamically typed framework-aware error helper (`RunnerError`) carrying HTTP codes, safe serialization, and remediation formatting.
- **Journal (`ExecutionJournal`)**: Typed state scoped to a single task execution, shared between middleware and the task runtime.
- **Runtime**: The bootstrapped graph initialized via `run(app)`, returning an API to execute tasks, emit events, and manage lifecycle.
- **Durable Workflow** (Node Only): Pausable, deterministic, resumable task execution using `step()` and `waitForSignal()`.
