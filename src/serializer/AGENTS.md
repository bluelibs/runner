# Serializer

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Responsibility

Portable, type-aware serialization for transport, persistence, and contexts.
This directory owns wire markers, graph identity, custom types, DTO field
metadata, and payload validation. It must work without Node-only imports.

## Start Here

- [Serializer.ts](Serializer.ts): public API, options, schemas, and orchestration.
- [types.ts](types.ts) and [index.ts](index.ts): exported contracts.
- [graph-serializer.ts](graph-serializer.ts): graph nodes and object references.
- [tree-serializer.ts](tree-serializer.ts): JSON-like tree serialization.
- [deserializer.ts](deserializer.ts): graph hydration, placeholders, legacy input.
- [type-registry.ts](type-registry.ts): custom/built-in type lookup and policies.
- [validation.ts](validation.ts), [regexp-validator.ts](regexp-validator.ts),
  and built-in modules validate untrusted payloads.
- [field-metadata.ts](field-metadata.ts) and [decorators.ts](decorators.ts):
  field aliases/exclusions and schema DTO integration.

## Contracts To Preserve

- `serialize()` uses graph mode and preserves shared identity/cycles;
  `stringify()` uses tree mode, copies shared references, and rejects cycles.
  `parse()` aliases `deserialize()`, which accepts graph and legacy/tree input.
- The graph envelope is versioned. Marker escaping must preserve ordinary data
  keys that resemble protocol markers; a reference record contains only `__ref`.
- Graph node ids belong to the serialization operation, not runtime definition ids.
  Reject unknown references, unsafe node ids/keys, and malformed typed payloads.
- Custom types default to reference strategy; value strategy intentionally does
  not preserve identity. Placeholder creation/merging must keep circular custom
  types and schema DTO instances coherent.
- Type registries/options belong to each Serializer instance. Do not leak custom
  types or mutable graph resolution state between instances/calls.
- Preserve depth limits, allowed types, symbol policy, RegExp limits/safety,
  and prototype-pollution defenses across graph and tree paths.

## Tests And Further Reading

- [Serializer tests](../__tests__/serializer): roundtrips, schema metadata,
  custom types, graph/legacy compatibility, and hostile payloads.
- [Regression tests](../__tests__/serializer/Serializer.regressions.test.ts)
  cover placeholders, special values, and prototype injection.
- [Reference tests](../__tests__/serializer/security-attacks.reference-hijacking.test.ts)
  and [tree tests](../__tests__/serializer/serializer-tree-validation.coverage.test.ts).
- [Wire protocol](../../readmes/SERIALIZER_PROTOCOL.md) is the protocol reference.
