# Match And Boundary Validation

This module owns `check`, Match patterns, compiled parsers, class-schema hydration,
structured failures, and JSON Schema export. Its public facade is the neighboring
[../check.ts](../check.ts), which also registers the check runtime.

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change
to reflect affected responsibilities, entry points, contracts, and tests. Keep it
concise and accurate; if the guidance remains accurate, make no artificial edits.

## Start Here

- [engine.ts](engine.ts) defines public Match factories, `check`, option validation,
  compiled parsers, and dispatch between schema-like parsers and patterns.
- [types.ts](types.ts) owns pattern inference and public schema/decorator contracts;
  [legacy-types.ts](legacy-types.ts) describes legacy decorator signatures.
- [matcher.ts](matcher.ts) is a facade over [matcher](matcher): `core.ts` manages
  traversal, `matching.ts` dispatches patterns, and `matchingObject.ts` checks keys.
- `matcher/definitions` owns pattern objects; `matcher/shared.ts` contains traversal
  budgets/context and shared rules used by matching and JSON Schema conversion.
- [decorators.ts](decorators.ts) records schema fields;
  [classSchema.ts](classSchema.ts) combines metadata, inheritance, and explicit bases.
- [hydration.ts](hydration.ts) and [hydration.helpers.ts](hydration.helpers.ts) create
  parsed class values while preserving recursive relationships.
- [errors.ts](errors.ts) and [errorFormatting.ts](errorFormatting.ts) preserve
  structured failure paths, expected values, and message overrides.
- [toJsonSchema.ts](toJsonSchema.ts) converts supported patterns;
  [runtime.ts](runtime.ts) breaks initialization cycles for schema-backed error helpers.

## Contracts To Preserve

- `check(value, pattern)` validates and returns the same value; parser-like schemas
  return their parser's output. Compiled Match `.parse()` can hydrate class schemas.
  `.test()` is validation-only. Do not silently blur these behaviors.
- Plain object patterns reject unknown own keys; `ObjectIncluding` permits extras.
  Required key presence is distinct from a present key whose value is undefined.
- Schema-like detection must leave ordinary object patterns deterministic; objects
  branded as Match patterns take the pattern path even if they expose parse methods.
- Default error policy is first failure unless the pattern/schema supplies another;
  explicit check options take precedence. Keep deprecated `throwAllErrors` compatible.
- Matching has a default depth budget of 1000; JSON Schema conversion uses its own
  smaller budget. Cycle detection does not replace depth limits for fresh wrappers.
- Metadata merges legacy and standard decorators, inheritance, and explicit bases;
  changes must invalidate the schema cache and reject circular base chains.
- JSON Schema export must report unsupported patterns explicitly rather than inventing
  equivalent validation. Runtime matching, export, and type inference must agree.
- Matcher traversal state belongs to each call. Shared registries/cache metadata
  must not retain input values or leak failure collections between validations.

## Tests And Consumers

- [../../__tests__/tools](../../__tests__/tools) contains `check.test.ts`,
  `check-schema-like-boundaries.test.ts`, `check.max-depth.test.ts`,
  `check.decorators.test.ts`, `check.hydration.test.ts`, and `check.to-json-schema.test.ts`.
- Type inference: [../../__tests__/type-tests/tools/check.type-test.ts](../../__tests__/type-tests/tools/check.type-test.ts).
- Framework boundary integration: [../../__tests__/validation](../../__tests__/validation)
  and [../../__tests__/definers/schema.normalization.unit.test.ts](../../__tests__/definers/schema.normalization.unit.test.ts).
- Coordinate metadata changes with [../../decorators](../../decorators), parsing
  contracts with [../../types/utilities.ts](../../types/utilities.ts), and normalization
  with [../../definers/normalizeValidationSchema.ts](../../definers/normalizeValidationSchema.ts).
