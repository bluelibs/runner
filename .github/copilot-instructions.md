# BlueLibs Runner: Dependency Injection Framework

BlueLibs Runner is a TypeScript-first dependency injection and task orchestration framework featuring Tasks, Resources, Events, and Middleware with functional programming principles.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap, Build, and Test

- **Install dependencies**: `npm install` -- takes ~2 minutes initially, ~30 seconds for updates. NEVER CANCEL.
- **Build**: `npm run build` -- takes <1 minute. NEVER CANCEL. Set timeout to 120+ seconds.
- **Run tests**: `npm test` -- takes ~13 seconds for 346 tests. NEVER CANCEL. Set timeout to 60+ seconds.
- **Test with coverage**: `npm run coverage` -- takes ~12 seconds. NEVER CANCEL. Set timeout to 60+ seconds.
- **Generate documentation**: `npm run typedoc` -- takes ~5 seconds. Creates docs in `./docs/`

### Development Workflow

- **TypeScript watch mode**: `npm run watch` -- monitors src/ for changes, recompiles automatically
- **Test watch mode**: `npm run test:dev` -- monitors tests, reruns on changes
- **Format code**: `npx prettier --write src` -- auto-formats all TypeScript files
- **Check formatting**: `npx prettier --check src` -- validates code formatting
- **Test watch mode**: `npm run coverage` -- runs coverage, enforces 100%.

- Write elegant code
- Coverage 100% is enforced.
- Adapt README.md and readmes/AI.md after a feature is done or a change.

### Known Limitations

- **ESLint**: Current ESLint config has compatibility issues with ESLint v9. Use Prettier for formatting instead.
- **Example app**: The express-mongo example has TypeScript dependency conflicts but core framework works perfectly.

# BlueLibs Runner: Minimal Guide

## Install

```bash
npm install @bluelibs/runner
```

Read readmes/AI.md before beginning any task because it contains a minimal token-friendly version of the entire README.md.
