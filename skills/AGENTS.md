# Published Runner Skill

> **Keep This Guide Current:** If you make changes within this directory, update this `AGENTS.md` in the same change whenever responsibilities, entry points, contracts, or test guidance change. Keep it concise and accurate; do not make artificial edits when the guidance still holds.

## Scope And Entry Points

`core/SKILL.md` is the repository's published Runner Developer skill. It routes readers to the core mental model, topic guides, and reusable snippets rather than duplicating all framework documentation.

- `core/references/snippets/`: canonical small Runner authoring examples.
- `core/references/guide-units` and `core/references/readmes`: symlinks to canonical repository documentation during development.
- `../scripts/pack-npm-skills.mjs`: replaces those links with copies for `prepack`, then restores them in `postpack`.
- `../package.json` declares the exported skill; `../.npmignore` allows the published skill tree.

## Contracts To Preserve

- Keep the skill's reading routes and snippet contracts aligned with the public API and canonical authored guides.
- Edit guide/readme sources in their original directories. Do not commit materialized packaging copies or alter symlink destinations casually.
- Keep snippets small, typed, builder-first, and valid with local IDs; show required imports and runtime wiring.
- A topic change may affect its main guide, compact AI guide, skill routing, and snippets; update only those whose content changes.

## Validation

Verify reference targets and snippet API usage against source and tests. Do not run packaging solely to check Markdown, because packaging intentionally replaces reference directories. Documentation-only changes need no full QA.
