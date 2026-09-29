# Ownership, Visibility, And Isolation

## Scope And Maintenance

These helpers back `../VisibilityTracker.ts`. They compile the registration
ownership graph into access decisions and boot-time wiring validation. Exports
control reachability across resource boundaries; isolate rules further restrict
access by channel.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points

- `state.ts` records resources, ownership/subtrees, definition tags, exports,
  and isolation policies; it also rolls back ownership trees.
- `policyCompiler.ts` compiles isolation selectors into channel sets.
- `accessEvaluator.ts` combines visibility and isolation violations.
- `visibilityAccess.ts` traverses owner/export chains, including exported
  resources and explicit descendant export surfaces.
- `isolationAccess.ts` evaluates isolate policies; `contracts.ts` defines
  compiled policy sets and structured violation variants.
- `visibilityValidation.ts`, `visibilityValidationEntries.ts`, and
  `visibilityValidationReferences.ts` collect and check wiring references.
- `throwAccessViolation.ts` maps violations to Runner errors.

## Contracts To Preserve

- All stateful ownership, subtree, tag, export, and policy sets use canonical
  runtime IDs. Resolve authored references before evaluation.
- Definitions are reachable within their owning subtree. Outside callers must
  satisfy export gates along the ownership chain.
- No exports declaration differs from an explicit empty export set; do not
  conflate absence with an empty iterable.
- Exporting a resource does not erase its own descendant export boundaries.
  Preserve traversal cycle protection and explicit direct exports.
- Visibility is evaluated before isolation. Keep violation details that explain
  which owner/export gate or policy/channel rejected the reference.
- Isolation is channel-specific; dependency, middleware, and tag access may
  differ. Match ID/tag/subtree/wildcard selectors through compiled contracts.
- Registration rollback must remove corresponding ownership policy state so a
  later valid registration is evaluated independently.

## Tests

- `../../__tests__/models/VisibilityTracker.visibility.test.ts`
- `../../__tests__/models/VisibilityTracker.state.test.ts`
- `../../__tests__/models/VisibilityTracker.only-mode.test.ts`
- `../../__tests__/models/VisibilityTracker.deny-mode.test.ts`
- `../../__tests__/models/VisibilityTracker.validation.test.ts`
- `../../__tests__/run/run.exports-visibility.direct-export-chain.test.ts`
- `../../__tests__/run/run.wiring-access-policy.channels.test.ts`
- `../../__tests__/run/run.exports-visibility.privileged-surfaces.test.ts`

Use runtime integration tests alongside helper tests for boundary changes, then
run repository QA for source edits.
