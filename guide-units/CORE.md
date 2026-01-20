# BlueLibs Runner Documentation

Consolidated 12-chapter structure for the README.

## Composition Order

Chapter filenames are case-sensitive on some filesystems (eg Linux CI). Keep `!include:` values an exact match for the files under `guide-units/`.

!include: 00-header.md
!include: 01-getting-started.md
!include: 02-core-concepts.md
!include: 03-runtime-lifecycle.md
!include: 04-features.md
!include: 05-observability.md
!include: 06-advanced.md
!include: 07-developer-experience.md
!include: 08-testing.md
!include: 09-troubleshooting.md
!include: 10-deep-dives.md
!include: 11-reference.md

## Chapter Mapping

| New File                   | Combines                                                 |
| -------------------------- | -------------------------------------------------------- |
| 00-header.md               | Header (unchanged)                                       |
| 01-getting-started.md      | Overview + Getting Started + Learning Guide + Quick Wins |
| 02-core-concepts.md        | Core Concepts (unchanged)                                |
| 03-runtime-lifecycle.md    | Runtime + Lifecycle                                      |
| 04-features.md             | Features + Utilities                                     |
| 05-observability.md        | Observability (unchanged)                                |
| 06-advanced.md             | Advanced Patterns + Architecture + Internals             |
| 07-developer-experience.md | Async Context + Fluent Builders + Type Helpers           |
| 08-testing.md              | Examples + Testing                                       |
| 09-troubleshooting.md      | Troubleshooting (unchanged)                              |
| 10-deep-dives.md           | Architecture Deep Dive + Integration Recipes             |
| 11-reference.md            | Quick Reference + Conclusion                             |

## Editing Guidelines

When editing chapters:

1. Follow DOCS_STYLE_GUIDE.md for tone, formatting, and structure
2. Keep sections focused - one concept per section
3. Use Mermaid diagrams for complex flows
4. End major sections with runtime quotes
5. Test code examples for syntax correctness

## Composition Command

```bash
npm run guide:compose
```
