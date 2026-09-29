# Node Files And Upload Sources

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Responsibility

Node-facing file sentinels and received single-use `InputFile` streams, with
helpers for buffering or writing them. The adjacent one-file upload module is
mapped here; HTTP encoding/decoding belongs to `../http` and `../exposure`.

## Start Here

- [createNodeFile.ts](createNodeFile.ts): public sentinel plus `_node` source sidecar.
- [inputFile.model.ts](inputFile.model.ts): `NodeInputFile`, stream consumption,
  temporary paths, and `toPassThrough()`.
- [inputFile.utils.ts](inputFile.utils.ts): buffering and writing to a specified path.
- [index.ts](index.ts): file exports.
- [Upload manifest](../upload/manifest.ts): recursively collects Node sentinel
  sources and builds the manifest copy used by the smart HTTP client.
- [Portable file contracts](../../types/inputFile.ts): metadata/sentinel/InputFile types.

## Contracts To Preserve

- Sentinel `id` identifies a file part within an upload, not a runtime definition.
  The wire sentinel keeps `$runnerFile`, `id`, and `meta`; `_node` is local source data.
- `createNodeFile()` packages either Buffer/Readable sources. Manifest collection
  prefers buffer when both are present and strips `_node` from the copied sentinel.
- The manifest walker reconstructs arrays/records; it is not graph serialization
  and does not implement cycle handling. Preserve the source input while cloning.
- `NodeInputFile.stream()` marks its stream consumed. `resolve()`, buffering,
  writing, and `toTempFile()` consume that same single-use stream and cannot be retried.
- Missing or already consumed streams throw Runner file errors.
- Temporary filenames sanitize the supplied name and add uniqueness; successful
  writes report bytes. Pipeline failures must reject instead of reporting success.
- `toPassThrough()` returns a distinct piped stream; it does not make its input replayable.

## Tests To Read

- [Node file tests](../__tests__/files): sentinels, single-use access, temp paths,
  stream failures, chunk normalization, and byte counts.
- [InputFile model](../__tests__/files/inputFile.model.test.ts).
- [Upload tests](../__tests__/upload): nested sentinels, stripped sidecars,
  buffer/stream precedence, and metadata preservation.
