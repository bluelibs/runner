# Runner Architecture Playbook

Use this playbook when the task is to design or review Runner itself.
Keep the result small, enforceable, and obvious in code.

## Table Of Contents

1. Design Checklist
2. Primitive Selection
3. Boundary Rules
4. Multi-Platform Rules
5. Testing And Docs
6. Review Heuristics

## Design Checklist

Answer these before implementation:

1. What user or framework pain does this solve?
2. What is the smallest public contract that solves it?
3. Which primitive owns the contract?
4. Which resource owns registration and lifecycle?
5. Which boundaries must stay closed by default?
6. How does the feature behave in `dev`, `prod`, and `test`?
7. Is the feature multi-platform or Node-only?
8. What would break if two `run(app)` containers execute in parallel?
9. Which tests prove the contract and which docs explain it?

If the answer to one of these is fuzzy, the code is probably still early.

## Primitive Selection

Use the smallest primitive that matches the job:

- `resource`: shared state, lifecycle, ownership, configuration, registration, visibility
- `task`: explicit unit of work and operator-facing entry point
- `event`: typed signal
- `hook`: reaction to an event when fan-out should stay explicit
- `middleware`: cross-cutting execution wrapper
- `tag`: typed discovery or policy surface
- `error`: reusable failure contract

Prefer composition over feature stacking.
If one primitive starts carrying unrelated concerns, split the design.

## Boundary Rules

Runner architecture should make boundaries enforceable, not advisory.

- Use `.isolate({ exports })` to define what a subtree exposes.
- Use `deny`, `only`, and `whitelist` for cross-boundary wiring policy.
- Use `subtreeOf(...)` for ownership-scoped rules instead of id-prefix guessing.
- Use `scope(...)` when a rule should affect only specific channels.
- Use `.subtree({ validate })` for policy enforcement that should fail at bootstrap.
- Use `r.override(...)` only when behavior changes but identity must stay the same.

Prefer bootstrap-time failure for invalid graphs.
If a misuse can be detected during wiring, do not defer it to first execution.

## Multi-Platform Rules

Default to shared runtime code.
Move code to `src/node/` only when the capability is genuinely Node-specific.

Before adding shared behavior, check whether it depends on:

- `process`
- shutdown signals
- `AsyncLocalStorage`
- filesystem access
- Node-only timers or transport assumptions

If yes, either:

- move the behavior behind a platform boundary, or
- make the feature explicitly Node-only and document it

Do not make browser or edge behavior look successful when the contract cannot actually hold there.

## Testing And Docs

For framework work, tests are part of the design:

- Write the smallest harness that proves the contract.
- Test failure paths, not only happy paths.
- Test isolation when a feature touches state, lifecycle, tenancy, or execution context.
- Test public API behavior before asserting internals.
- Add regression tests when fixing subtle bootstrap or boundary bugs.

Update docs when the public story changes:

- `guide-units/` when composed docs should change
- `readmes/COMPACT_GUIDE.md` when the compact public story changes
- code JSDoc when a public surface changes

## Review Heuristics

During review, ask:

- Is the contract smaller than the implementation?
- Is ownership obvious from the resource tree?
- Are boundaries explicit and enforceable?
- Would two parallel runtimes stay isolated?
- Is the public type story stricter and clearer than before?
- Is any Node-only assumption leaking into shared code?
- Do tests prove the contract instead of the current implementation shape?

Smells that usually mean the design needs another pass:

- feature logic split across unrelated globals with no clear owner
- runtime branching scattered across many files
- new public surface without JSDoc
- silent fallback where Runner usually fails fast
- tests that require booting far more graph than the contract needs
