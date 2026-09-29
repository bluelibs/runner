# Authored Guide Units

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Scope

These are the canonical source chapters for composed documentation. Read [DOCS_STYLE_GUIDE.md](DOCS_STYLE_GUIDE.md) before authoring; it governs terminology, examples, links, and composition.

## Entry Points

- `INDEX_README.md` includes the landing-page sources; `INDEX_GUIDE.md` includes the full learning guide.
- `00-header.md`, `00-overview.md`, and `01-readme.md` establish the public story.
- `02-*.md` / `02b-*.md` through `02f-*.md` cover the building blocks; `03-runtime-lifecycle.md` owns the lifecycle explanation.
- `04-*.md` and related chapters describe features, validation/serialization, and security; later chapters cover observability, internals, and testing.
- Advanced topic docs live in [../readmes/AGENTS.md](../readmes/AGENTS.md).

## Authoring Contracts

- Edit source chapters and manifests, then run `npm run guide:compose` from the repository root when composition inputs change.
- Do not edit or read generated `FULL_GUIDE.md` as a source. Root `README.md` is generated too.
- A new chapter is included only when an explicit `!include:` manifest entry adds it. This `AGENTS.md` is contributor context and is not a composed chapter.
- Keep examples runnable, imports explicit, local IDs valid, and defaults/lifecycle effects precise. Check claims against source and representative tests.
- Preserve relative links; the composer rewrites supported paths and intra-guide links for the generated full guide.
- Update `../readmes/COMPACT_GUIDE.md` minimally when the core public story changes. Durable workflows and remote lanes keep their own focused guides.

## Validation

Verify references and examples against the relevant source module guide. Compose changed inputs and review generated diffs; an `AGENTS.md`-only change does not need composition. Documentation-only work does not need `npm run qa`.
