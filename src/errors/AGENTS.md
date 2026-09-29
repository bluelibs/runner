# Framework Errors

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Scope And Entry Points

Framework failures use typed Runner helpers rather than ad hoc `Error` instances. `../errors.ts` is the public barrel; domain modules also own specialized helpers.

- `foundation.errors.ts` re-exports graph, isolation, runtime, event, platform, RPC-lane, Match, and validation errors from `foundation/`.
- `model-runtime.errors.ts` describes failures owned by runtime services such as queues, semaphores, journals, and dependency processing.
- `domain-runtime.errors.ts` defines helpers for HTTP, middleware, serialization, Node files/exposure, durable operations, and other domain boundaries.
- `domain-error-ids.ts` supplies stable domain error identifiers.
- `generic.errors.ts` is the fallback when a stable typed contract cannot be represented.
- Error construction itself lives in `../definers/defineError.ts` and `../definers/builders/error/`; public helper types live in `../types/error.ts`.

## Contracts To Preserve

- Keep helper data, identifiers, HTTP codes, formatting, remediation, and serialization semantics consistent with callers and tests.
- Prefer a specific typed error and fail at the violated boundary. A generic fallback must not hide a known invariant failure.
- Foundation errors participate in definition setup; preserve the existing factory/registry arrangement to avoid import cycles during boot.
- Transport-safe error representations and internal diagnostic data have different audiences. Follow the owning domain's exposure contract.
- Use the right identity in diagnostics: local declaration ID, canonical registration ID, execution ID, and display name are not interchangeable.

## Validation

Start with `../__tests__/errors/` and the affected domain's tests. Cover the helper's observable data and behavior, not just its message. For code changes run focused tests, then `npm run qa`.
