# README Composition System

## Overview

The README.md is now componentized into individual chapter files for better maintainability and AI-friendly editing. This structure makes it easier to manage large documentation, collaborate on specific sections, and work with LLMs that have token limitations.

## Directory Structure

```
guide-units/
├── CORE.md                 # Master orchestration file (lists all chapters in order)
├── README.md              # This file
├── 00-HEADER.md           # Header, intro, resources table
├── 01-OVERVIEW.md         # Overview, comparisons, benchmarks
├── 02-GETTING_STARTED.md  # First 5 minutes, quick start
├── 03-LEARNING_GUIDE.md   # Learning patterns
├── 04-QUICK_WINS.md       # 5 copy-paste solutions
├── 05-CORE_CONCEPTS.md    # Tasks, Resources, Events, Middleware, Tags, Errors
├── 06-QUICK_REFERENCE.md  # API cheat sheet
├── 07-RUNTIME.md          # run(), RunOptions, Task Interceptors
├── 08-ADVANCED_PATTERNS.md # Optional deps, Serialization, Tunnels
├── 09-ASYNC_CONTEXT.md    # Async context and request state
├── 10-FLUENT_BUILDERS.md  # Fluent builder API
├── 11-TYPE_HELPERS.md     # TypeScript utilities
├── 12-LIFECYCLE.md        # Shutdown hooks, error boundaries
├── 13-FEATURES.md         # Caching, retry, timeouts, performance
├── 14-OBSERVABILITY.md    # Logging, debug, metadata
├── 15-ARCHITECTURE.md     # Overrides, namespacing, validation
├── 16-INTERNALS.md        # Internal services, circular dependencies
├── 17-EXAMPLES.md         # Real-world examples
├── 18-TESTING.md          # Testing patterns
├── 19-UTILITIES.md        # Semaphore, Queue
└── 20-CONCLUSION.md       # Why Runner, migration, community, license
```

## How It Works

The composition system uses a simple manifest-based approach:

1. **CORE.md** contains a list of `!include:` directives that reference each chapter file
2. **compose-readme.mjs** reads CORE.md, parses the manifest, and concatenates all chapters
3. **npm run guide:compose** regenerates the final README.md

## Workflow

### Making Changes

1. Edit individual chapter files in the `guide-units/` directory
2. Keep CORE.md updated if adding/removing/reordering chapters
3. Run `npm run guide:compose` to regenerate README.md
4. Review the changes: `git diff README.md`
5. Commit both the chapter file and the updated README.md

### Example

```bash
# Edit a specific chapter
nano guide-units/05-CORE_CONCEPTS.md

# Regenerate README
npm run guide:compose

# Review the output
git diff README.md

# Commit
git add guide-units/05-CORE_CONCEPTS.md README.md
git commit -m "docs: enhance core concepts documentation"
```

## Benefits

### For Development Teams

- **Parallel Work**: Multiple contributors can edit different chapters without merge conflicts
- **Clear Organization**: Each section has a dedicated file
- **Version Control**: Easier to track which parts of documentation changed
- **Maintenance**: Simpler to find and update specific sections

### For AI/LLM Integration

- **Token Efficiency**: Individual chapters are smaller and fit within token budgets
- **Focused Context**: LLMs can work on specific chapters without massive files
- **Composition Awareness**: System explicitly designed for programmatic document assembly
- **Progressive Updates**: Edit one chapter at a time without rewriting the entire README

## Guidelines for Contributors

### When Editing Chapters

1. **Maintain Headers**: Each chapter should start with its main header (`##`)
2. **Self-Contained**: Content should be complete and readable independently
3. **Cross-References**: Use relative markdown links when needed
4. **Line Length**: Keep lines reasonable (80-120 chars) for readability
5. **Examples**: Include code examples in chapters where relevant

### When Adding New Chapters

1. Create a new file with naming pattern: `NN-CHAPTER_NAME.md` (e.g., `21-NEW_FEATURE.md`)
2. Add an `!include:` line to CORE.md in the correct position
3. Update the chapter descriptions in CORE.md
4. Run `npm run guide:compose` to test
5. Update the chapter list in this file

### When Removing Chapters

1. Delete or archive the chapter file
2. Remove the `!include:` line from CORE.md
3. Update descriptions
4. Run `npm run guide:compose`

## Composition Script

The `compose-readme.mjs` script is the engine that drives this system:

```bash
npm run guide:compose
```

### What It Does

- Parses `guide-units/CORE.md`
- Extracts all `!include:` directives
- Loads each chapter file in order
- Concatenates them into README.md
- Reports success with line count

### Error Handling

- Warns if a chapter file is missing
- Fails if CORE.md can't be found
- Exits with status 1 on error

## Future Enhancements

Potential improvements to the system:

1. **Table of Contents Generation**: Auto-generate TOC from headers
2. **Cross-Reference Validation**: Verify all internal links work
3. **Link Rewriting**: Update relative paths when needed
4. **Chapter Templates**: Template files for new chapter creation
5. **Validation**: Check for consistent formatting across chapters
6. **Publishing**: Generate multiple formats (HTML, PDF, etc.)

## Statistics

- **Total Chapters**: 21
- **Total Lines**: ~4,400
- **Average Chapter Size**: ~200 lines
- **Largest Chapters**: Core Concepts (22KB), Architecture (21KB), Observability (13KB)
- **Smallest Chapters**: Async Context (1.5KB), Fluent Builders (1.7KB)

## Questions?

For questions about the documentation structure or how to contribute:

1. Check the [CONTRIBUTING.md](../CONTRIBUTING.md) guide
2. Open an issue on [GitHub](https://github.com/bluelibs/runner/issues)
3. Join the discussion in [Discord](https://discord.gg/bluelibs)
