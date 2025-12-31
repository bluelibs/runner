# BlueLibs Runner - README Composition

This directory contains the modular components of the README.md file, split into logical chapters for easier management and AI-friendly editing.

## How It Works

The `compose-readme.mjs` script reads this file and includes all referenced chapters in order to generate the final README.md.

## Chapter Manifest

!include: 00-HEADER.md
!include: 01-OVERVIEW.md
!include: 02-GETTING_STARTED.md
!include: 03-LEARNING_GUIDE.md
!include: 04-QUICK_WINS.md
!include: 05-CORE_CONCEPTS.md
!include: 06-QUICK_REFERENCE.md
!include: 07-RUNTIME.md
!include: 08-ADVANCED_PATTERNS.md
!include: 09-ASYNC_CONTEXT.md
!include: 10-FLUENT_BUILDERS.md
!include: 11-TYPE_HELPERS.md
!include: 12-LIFECYCLE.md
!include: 13-FEATURES.md
!include: 14-OBSERVABILITY.md
!include: 15-ARCHITECTURE.md
!include: 16-INTERNALS.md
!include: 17-EXAMPLES.md
!include: 18-TESTING.md
!include: 19-UTILITIES.md
!include: 20-CONCLUSION.md

## Chapter Descriptions

### 00-HEADER.md
The header, introduction, resources table, and community information. Sets the tone for the entire README.

### 01-OVERVIEW.md
What is Runner, comparison with other frameworks, performance benchmarks, and feature matrix.

### 02-GETTING_STARTED.md
Your first 5 minutes, quick start examples, and basic setup patterns.

### 03-LEARNING_GUIDE.md
Common patterns and learning guide for developers new to Runner.

### 04-QUICK_WINS.md
5 copy-paste solutions for real-world problems (caching, retry, timeouts, events, logging).

### 05-CORE_CONCEPTS.md
The Big Five: Tasks, Resources, Events, Middleware, Tags, and Errors - the foundation of Runner.

### 06-QUICK_REFERENCE.md
Cheat sheet with quick lookups for common patterns and API usage.

### 07-RUNTIME.md
run() function, RunOptions, Task Interceptors, and error handling.

### 08-ADVANCED_PATTERNS.md
Optional dependencies, Serialization, and Tunnels for distributed systems.

### 09-ASYNC_CONTEXT.md
Request-scoped and thread-local state management.

### 10-FLUENT_BUILDERS.md
The fluent builder API for ergonomic component definition.

### 11-TYPE_HELPERS.md
TypeScript utility types for extracting types from components.

### 12-LIFECYCLE.md
System shutdown hooks, graceful shutdown, error boundaries, and cleanup.

### 13-FEATURES.md
Core features: Caching, Retry, Timeouts, and Performance optimization.

### 14-OBSERVABILITY.md
Logging, Debug resource, and Metadata for observability and documentation.

### 15-ARCHITECTURE.md
Overrides, Namespacing, Factory pattern, and Runtime validation.

### 16-INTERNALS.md
Internal services, Dynamic dependencies, and Handling circular dependencies.

### 17-EXAMPLES.md
Real-world example showing everything working together.

### 18-TESTING.md
Unit and integration testing patterns.

### 19-UTILITIES.md
Semaphore and Queue for concurrency control and task scheduling.

### 20-CONCLUSION.md
Why choose Runner, migration path, community information, and license.

## Editing Guidelines

When editing chapters:

1. **Maintain the file structure**: Each chapter should be a complete, self-contained markdown file
2. **Include headers**: Each chapter should start with its main header (##) and content below
3. **Cross-references**: Use relative markdown links when referencing sections in other chapters
4. **Keep CORE.md updated**: When adding/removing/reordering chapters, update the manifest and descriptions above
5. **Test composition**: After editing, run `npm run compose:readme` to regenerate README.md and verify it looks correct

## AI-Friendly Benefits

This structure enables:

- **Focused editing**: Work on single chapters without dealing with massive 4000+ line files
- **Parallel work**: Multiple contributors can edit different chapters simultaneously
- **Better token efficiency**: LLMs can work with smaller, focused contexts
- **Version control**: Easier to track changes in specific sections
- **Maintenance**: Easier to find and update specific documentation areas

## Composition Workflow

```bash
# Make changes to any chapter file (e.g., readme-composed/05-CORE_CONCEPTS.md)
nano readme-composed/05-CORE_CONCEPTS.md

# Regenerate the README
npm run compose:readme

# Verify the output
git diff README.md

# Commit your changes
git add readme-composed/ README.md
git commit -m "docs: update core concepts chapter"
```
