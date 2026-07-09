# Public API Governance

← [Back to main README](../README.md)

Runner classifies runtime values from the universal, Node, and decorator entrypoints so additions
to the executable package surface are deliberate.
The executable manifest lives in
[`config/public-api/runtime-exports.json`](../config/public-api/runtime-exports.json)
and is enforced by the test suite.

## Application API

Application APIs are the normal authoring and runtime surfaces. They include fluent builders,
`run(...)`, built-in definitions, validation, serialization, and the primary Node integrations.
These APIs carry the strongest compatibility expectations.

## Advanced API

Advanced APIs support framework integrations, custom tooling, and low-level runtime work. They
are public and versioned, but application code should prefer the higher-level application API
when it provides the required contract.

## Legacy API

Legacy APIs remain available for compatibility. New code should use their documented replacement.

## Internal Candidates

Internal candidates are currently exported for compatibility but expose framework implementation
details. New application code should not adopt them. This category creates an explicit review list
for a future major version instead of pretending every historical export is equally intentional.

## Changing The Surface

When adding, moving, or removing a runtime export:

1. Classify it in the manifest.
2. Document why it belongs in that category.
3. Treat removal or category changes as compatibility decisions.
4. Run the public API classification test before publishing.

This classification covers runtime values. Type-only exports remain governed separately by the
TypeScript declaration build and semantic-versioning policy.
