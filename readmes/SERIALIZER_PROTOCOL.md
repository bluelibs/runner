# Serializer Protocol (Internal)

This document describes the JSON wire format produced and accepted by `Serializer`.

Scope:

- This is an internal protocol reference for Runner contributors and maintainers.
- It is not part of the public, end-user documentation.
- Backwards compatibility is best-effort; treat `version` as the contract boundary.

---

## Configuration options

The serializer accepts the following options:

| Option                   | Type       | Default | Description                                                        |
| ------------------------ | ---------- | ------- | ------------------------------------------------------------------ |
| `maxDepth`               | `number`   | `1000`  | Maximum recursion depth for serialization/deserialization          |
| `maxRegExpPatternLength` | `number`   | `1024`  | Maximum allowed RegExp pattern length                              |
| `allowUnsafeRegExp`      | `boolean`  | `false` | Allow patterns that fail the safety heuristic (nested quantifiers) |
| `allowedTypes`           | `string[]` | `null`  | Whitelist of type IDs allowed during deserialization (null = all)  |
| `pretty`                 | `boolean`  | `false` | Enable indented JSON output                                        |

---

## Two formats

The serializer understands two payload shapes:

1. **Legacy tree format** (plain JSON)
2. **Graph format** (identity-preserving, supports cycles)

The implementation chooses graph format when it needs to preserve identity or represent cycles; otherwise it may emit a plain JSON value.

---

## Legacy tree format

Any JSON value is a valid legacy payload:

- primitives: `string | number | boolean | null`
- arrays
- objects

### Typed values (legacy)

Typed values are encoded as:

```json
{ "__type": "Date", "value": "2024-01-01T00:00:00.000Z" }
```

The type id is resolved via the internal type registry.

### Safety rules (legacy)

When deserializing legacy objects, keys listed in the unsafe-key set are filtered out to prevent prototype pollution:

- `__proto__`
- `constructor`
- `prototype`

Filtered keys do not appear in the resulting object.

---

## Graph format

Graph payloads are objects with the following shape:

```ts
type GraphPayload = {
  __graph: true;
  version: 1;
  root: SerializedValue;
  nodes: Record<string, SerializedNode>;
};
```

Notes:

- `nodes` is treated as a key/value table of node ids to node records.
- `nodes` is normalized into a null-prototype record during deserialization.

### References

References are objects of the shape:

```json
{ "__ref": "obj_1" }
```

During graph deserialization, references are resolved against `nodes`.

Safety rule: unsafe reference ids (`__proto__`, `constructor`, `prototype`) are rejected.

### Node kinds

Each `nodes[id]` value is a node record with a `kind` discriminator:

#### `object`

```json
{ "kind": "object", "value": { "a": 1, "b": { "__ref": "obj_2" } } }
```

- `value` is an object whose values are `SerializedValue`.
- Unsafe keys are filtered during deserialization.

#### `array`

```json
{ "kind": "array", "value": [1, { "__ref": "obj_1" }, 3] }
```

- `value` is an array of `SerializedValue`.

#### `type`

```json
{ "kind": "type", "type": "Map", "value": [["k", "v"]] }
```

- `type` is the type id in the registry.
- `value` is the serialized payload for that type, which is recursively deserialized.

Typed values can also appear inline (outside `nodes`) using the legacy type-record shape:

```json
{ "__type": "RegExp", "value": { "pattern": "test", "flags": "gi" } }
```

### Type strategies

Custom types can use one of two serialization strategies:

- **identity** (default): The type is stored as a graph node, preserving object identity across multiple references.
- **value**: The type is serialized inline without identity tracking. Used for immutable/value-like types (e.g., `Date`, `RegExp`).

### Circular reference handling

The deserializer uses a `resolved` cache to handle circular references safely:

1. When a node is first encountered, a placeholder is stored in `resolved` immediately.
2. Child values are recursively deserialized.
3. If a `__ref` points to an already-resolving node, the cached placeholder is returned.
4. This breaks infinite loops and preserves identity.

For typed nodes with a `create()` factory, the placeholder is the result of `create()`. After full deserialization, properties are merged into the placeholder to maintain identity across circular references.

---

## Serialization rules (important edge cases)

These rules are applied by both formats:

- `undefined` is preserved via `{ "__type": "Undefined", "value": null }`.
- non-finite numbers (`NaN`, `Infinity`, `-Infinity`) are preserved via `{ "__type": "NonFiniteNumber", "value": "NaN" | "Infinity" | "-Infinity" }`.
- `bigint`, `symbol`, and `function` are rejected (throw).

Previous versions of the protocol serialized these as `null` (matching `JSON.stringify`). Modern versions prefer data integrity.

---

## Depth and resource limits

Deserialization is guarded by a depth counter:

- `maxDepth` defaults to **1000**.
- Valid values: non-negative finite integers, or `Infinity` for no limit.
- Invalid values (`-5`, `NaN`, `undefined`) fall back to the default.
- When `depth > maxDepth`, deserialization throws `Maximum depth exceeded (N)`.

RegExp payloads are validated:

- `maxRegExpPatternLength` defaults to **1024**; `Infinity` disables length checking.
- A safety heuristic rejects patterns with nested quantifiers (e.g., `(a+)+`) unless `allowUnsafeRegExp` is `true`.

### Security protections

- **Prototype pollution**: Keys `__proto__`, `constructor`, `prototype` are filtered from all objects.
- **Unknown types**: Type IDs must match registered types exactly; no dynamic resolution.
- **Type whitelist**: When `allowedTypes` is set, only listed types are allowed during deserialization.
- **Reference safety**: Reference IDs matching unsafe keys are rejected.

---

## Versioning

`version` is reserved for protocol changes. Current graph version:

- `version: 1`

The deserializer currently uses `__graph: true` plus basic shape checks to detect graph payloads; `version` is expected to match the current graph shape.
