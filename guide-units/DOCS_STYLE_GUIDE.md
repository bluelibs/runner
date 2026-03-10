# BlueLibs Runner Documentation Style Guide

Use this guide to keep Runner docs consistent without turning every doc change into a writing project.

**Last updated:** March 2026

## Purpose

Runner docs are composed from small guide units. This guide defines the minimum contract for:

- terminology
- chapter structure
- writing style
- code example quality
- composition workflow

If a rule here conflicts with clarity, prefer clarity and keep the change small.

## Core Terms

Use Runner vocabulary consistently:

| Use          | Meaning                                                      |
| ------------ | ------------------------------------------------------------ |
| `task`       | typed business action with DI, middleware, and observability |
| `resource`   | singleton with lifecycle                                     |
| `event`      | typed signal                                                 |
| `hook`       | reaction subscribed to an event                              |
| `middleware` | cross-cutting wrapper                                        |
| `tag`        | metadata for discovery/filtering                             |
| `app`        | root resource                                                |
| `runtime`    | object returned by `run(app)`                                |

Prefer these terms instead of loose alternatives:

- `app`, not `root` or `container`
- `hook`, not `listener` when the subject is Runner events
- `resource`, not `provider` or `module` when the subject is a Runner building block
- `dependencies`, not `inject`

## Writing Style

- Write like a senior engineer explaining a pattern to another engineer.
- Be practical. Lead with the problem, then the pattern, then the code.
- Prefer short paragraphs and short sections.
- Use "you" and "we" naturally, but avoid hype.
- No emojis.
- Prefer Title Case headings.
- Avoid filler headings like "Introduction" unless they add structure.

For landing and intro-facing docs:

- lead with the problem and first success quickly
- keep navigation short
- state important constraints early
- avoid long feature inventories above the fold
- use outcome-based encouragement sparingly, usually after a meaningful example

Heading rules:

- use `#` only for the document title
- use `##` for major sections and `###` for sub-sections
- prefer descriptive headings over generic ones
- avoid decorative punctuation in headings

## Section Pattern

Most concept chapters should follow this order:

1. What this concept owns.
2. One runnable example.
3. A short explanation of why it works this way.
4. A compact list of rules, tradeoffs, or best practices.
5. Links to deeper sections only if needed.

Do not front-load chapters with large comparison tables, multiple alternative examples, or repetitive motivation.

For learning-path chapters, keep sections in teaching order rather than alphabetical. For lookup/reference sections, optimize for scanability.

## Code Examples

Documentation examples are part of the public contract. Keep them stable, readable, and copy-paste friendly.

### General Rules

- Show imports unless the example is intentionally partial.
- Prefer complete runnable TypeScript examples.
- If an example is partial, state what is assumed.
- Use descriptive local ids with no dots.
- Keep one example inside one small domain unless the point is composition across domains.
- State important option defaults when documenting configuration or builder options.
- Call out options that change lifecycle, registration, or runtime wiring behavior.

### Naming Rules

- Root resource: `app`
- Logger: `logger`
- Config object: `config`
- Runtime result: `runtime`, or destructure `{ runTask, dispose }` when that reads better
- Task ids: verbs like `createUser`
- Event ids: past-tense actions or nouns like `userCreated`
- Resource ids: nouns like `database` or `userStore`

### Comments

- Comment the why, not the syntax.
- Use comments sparingly.
- Prefer a short explanation after the code block over inline commentary noise.

### Schemas

- Use the library-native schema style already used by the surrounding docs.
- Prefer concise schemas in simple examples.
- Use richer validation only when the example is about validation or real-world contracts.

### Progressive Teaching

When introducing a concept, prefer this progression:

1. smallest useful example
2. same idea with dependencies
3. cross-cutting behavior such as middleware or validation
4. real-world composition only if it adds something new

## Formatting

- Use bullet lists for grouped facts.
- Use numbered lists for ordered steps.
- Always label fenced code blocks with a language when possible.
- Use tables only for real comparison/reference value.
- Use blockquotes for notes or platform warnings, not for decoration.

Keep visual structure simple. If a table, Mermaid diagram, or two-column layout does not add clarity, remove it.

Useful callouts:

- `> **Platform Note:**` for runtime/platform limitations
- `> **Note:**` for important clarifications
- `> **Tip:**` for practical guidance

## Runtime Quotes

`runtime` quotes are optional flavor, not a requirement.

- Use at most one per major section.
- Keep them relevant and brief.
- Skip them in `AI.md`, quick references, troubleshooting, and API-style sections.
- If the quote makes the section longer without making it clearer, cut it.

## Composition System

Do not edit generated docs directly.

- [guide-units/INDEX_README.md](INDEX_README.md) composes `README.md`
- [guide-units/INDEX_GUIDE.md](INDEX_GUIDE.md) composes `readmes/FULL_GUIDE.md`
- Use `!include: file.md` manifests
- Run `npm run guide:compose` after changing composed guide units

Guide unit rules:

- keep chapters self-contained
- use relative links and anchors
- prefer `NN-chapter-name.md` naming for ordered guide units
- keep files reasonably small; split before they become hard to scan
- move deep dives to `readmes/` when they do not belong in the main learning path

Supplementary doc rules:

- `readmes/` is for focused deep dives such as platform-specific or advanced topics
- supplementary docs should link back to the main README when that helps navigation
- use full URLs only for external resources

## AI.md

[AI.md](../readmes/AI.md) is the token-efficient field guide.

- keep it concise
- omit flavor text and runtime quotes
- preserve core mental models and key contracts
- update it when a docs change meaningfully changes the public story
- keep it aligned with the composed docs, not with stale drafts

## Checklist

Before finishing a docs change:

- terminology matches Runner vocabulary
- examples use stable names and valid imports
- partial examples clearly state assumptions
- generated docs were rebuilt if composition inputs changed
- links and anchors still make sense
- `AI.md` was updated if the documentation contract changed
- no generated file was edited manually

## Default Standard

When in doubt, optimize for:

1. accuracy
2. shortest clear explanation
3. one good example instead of three average ones
4. strong terminology consistency
