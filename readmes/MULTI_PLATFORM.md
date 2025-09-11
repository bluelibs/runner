# Multi-Platform Architecture Guide

Welcome to the BlueLibs Runner multi-platform architecture! This guide will walk you through one of our most interesting architectural decisions: **how we made a single codebase work seamlessly across Node.js, browsers, edge workers, and other JavaScript runtimes**.

## 🎯 The Challenge We Solved

JavaScript runs everywhere these days - Node.js servers, browser tabs, Cloudflare Workers, Deno, Bun, and more. Each environment has its own quirks:

- **Node.js** has `process.exit()`, `process.env`, and `AsyncLocalStorage`
- **Browsers** have `window.addEventListener` and no concept of "process exit"
- **Edge Workers** are like browsers but without DOM APIs
- **Deno/Bun** are Node-like but with their own global objects

The challenge? How do you write a dependency injection framework that works everywhere without duplicating code?

## 🏗️ Our Solution: Platform Adapters

We created a **platform adapter system** that abstracts away runtime differences behind a common interface. Think of it as a translation layer between your application code and the underlying JavaScript runtime.

### The Core Interface

```typescript
interface IPlatformAdapter {
  // Process management
  onUncaughtException(handler: (error: Error) => void): () => void;
  onUnhandledRejection(handler: (reason: unknown) => void): () => void;
  onShutdownSignal(handler: () => void): () => void;
  exit(code: number): void;

  // Environment access
  getEnv(key: string): string | undefined;

  // Async context tracking
  hasAsyncLocalStorage(): boolean;
  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T>;

  // Timers (already universal!)
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}
```

This interface captures **what every runtime needs to provide** for a dependency injection container to work properly.

## 🔍 Smart Environment Detection

The magic starts with environment detection. We don't just guess - we carefully probe the global environment:

```typescript
export function detectEnvironment(): PlatformEnv {
  // Browser: has window and document
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return "browser";
  }

  // Node.js: has process.versions.node
  if (typeof process !== "undefined" && process.versions?.node) {
    return "node";
  }

  // Deno: has global Deno object
  if (typeof globalThis.Deno !== "undefined") {
    return "universal";
  }

  // Bun: has process.versions.bun
  if (typeof globalThis.Bun !== "undefined" || process.versions?.bun) {
    return "universal";
  }

  // Edge Workers: has WorkerGlobalScope
  if (
    typeof globalThis.WorkerGlobalScope !== "undefined" &&
    self instanceof globalThis.WorkerGlobalScope
  ) {
    return "edge";
  }

  // Fallback for unknown environments
  return "universal";
}
```

**Why this approach?** We check for the most specific features first, then fall back to broader categories. This means when new runtimes appear, they'll likely work out of the box.

## 🎭 Meet the Platform Adapters

### NodePlatformAdapter

The full-featured adapter for Node.js environments:

```typescript
export class NodePlatformAdapter implements IPlatformAdapter {
  // Hook into Node's process events
  onUncaughtException(handler) {
    process.on("uncaughtException", handler);
    return () => process.off("uncaughtException", handler);
  }

  // Handle graceful shutdown
  onShutdownSignal(handler) {
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
    // Return cleanup function
  }

  // Real process.exit()
  exit(code: number) {
    process.exit(code);
  }

  // Full AsyncLocalStorage support
  hasAsyncLocalStorage() {
    return true; // Node has native ALS
  }
}
```

**Why Node.js is special:** It has the richest feature set - real process control, proper signal handling, and native async context tracking.

### BrowserPlatformAdapter

Translates browser concepts to our interface:

```typescript
export class BrowserPlatformAdapter implements IPlatformAdapter {
  // Browser "uncaught exceptions" = window error events
  onUncaughtException(handler) {
    const target = window ?? globalThis;
    const h = (e) => handler(e?.error ?? e);
    target.addEventListener("error", h);
    return () => target.removeEventListener("error", h);
  }

  // Browser "shutdown" = page unload
  onShutdownSignal(handler) {
    window.addEventListener("beforeunload", handler);
    // Also handle page visibility changes
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") handler();
    });
  }

  // Can't exit a browser tab from JavaScript!
  exit() {
    throw new PlatformUnsupportedFunction("exit");
  }

  // No AsyncLocalStorage in browsers
  hasAsyncLocalStorage() {
    return false;
  }
}
```

**Key insight:** Browsers don't have "processes" but they do have lifecycle events we can map to our interface. The user closing a tab is conceptually similar to SIGTERM.

### EdgePlatformAdapter

Simple but effective for worker environments:

```typescript
export class EdgePlatformAdapter extends BrowserPlatformAdapter {
  // Workers have even fewer lifecycle guarantees
  onShutdownSignal(handler) {
    return () => {}; // No reliable shutdown signal
  }
}
```

**Design choice:** Edge workers are like browsers but even more constrained. We inherit most browser behavior but remove unreliable features.

## 🎪 The Universal Adapter: Our Secret Sauce

The `UniversalPlatformAdapter` is where things get really interesting. It's a **lazy-loading, runtime-detecting adapter**:

```typescript
export class UniversalPlatformAdapter implements IPlatformAdapter {
  private inner: IPlatformAdapter | null = null;

  private get() {
    if (!this.inner) {
      const kind = detectEnvironment();
      switch (kind) {
        case "node":
          this.inner = new NodePlatformAdapter();
          break;
        case "browser":
          this.inner = new BrowserPlatformAdapter();
          break;
        case "edge":
          this.inner = new EdgePlatformAdapter();
          break;
        default:
          this.inner = new GenericUniversalPlatformAdapter();
      }
    }
    return this.inner;
  }

  // Delegate everything to the detected adapter
  onUncaughtException(handler) {
    return this.get().onUncaughtException(handler);
  }
  // ... more delegation
}
```

**Why lazy loading?** Environment detection might be expensive, and some code paths might never need platform features. We only detect when actually needed.

**Why delegation?** Once we know what runtime we're in, we can use the specialized adapter optimized for that environment.

## 📦 Build-Time Optimization

Here's where it gets clever. We don't just detect at runtime - we also **optimize at build time** using different bundles:

```typescript
// tsup.config.ts creates different bundles with __TARGET__ defined

// In factory.ts:
export function createPlatformAdapter(): IPlatformAdapter {
  if (typeof __TARGET__ !== "undefined") {
    switch (__TARGET__) {
      case "node":
        return new NodePlatformAdapter();
      case "browser":
        return new BrowserPlatformAdapter();
      case "edge":
        return new EdgePlatformAdapter();
    }
  }
  return new UniversalPlatformAdapter();
}
```

**The magic:** When you import from `@bluelibs/runner/node`, you get a bundle where `__TARGET__` is hardcoded to `"node"`. No runtime detection needed!

### Package.json Exports

Our package.json shows the full strategy:

```json
{
  "exports": {
    ".": {
      "browser": "./dist/browser/index.mjs",
      "node": "./dist/node/index.mjs",
      "import": "./dist/universal/index.mjs"
    },
    "./edge": "./dist/edge/index.mjs"
  }
}
```

**Result:** Node.js bundlers automatically get the Node-optimized version, browsers get the browser-optimized version, and everything else gets the universal version with runtime detection.

## 🔄 Backwards Compatibility

We didn't break existing code. The old `PlatformAdapter` class is now a wrapper:

```typescript
export class PlatformAdapter implements IPlatformAdapter {
  private inner: IPlatformAdapter;

  constructor(env?: PlatformEnv) {
    // Tests used to pass explicit environments
    const kind = env ?? detectEnvironment();
    switch (kind) {
      case "node":
        this.inner = new NodePlatformAdapter();
        break;
      // ...etc
    }
  }

  // Delegate everything to the new adapters
  onUncaughtException(handler) {
    return this.inner.onUncaughtException(handler);
  }
}
```

**Design principle:** New code gets the benefits, old code keeps working.

## 🤔 Interesting Design Decisions

### Why Not Feature Detection?

We could test `if (typeof process !== 'undefined')` everywhere, but that gets messy fast. The adapter pattern centralizes all environment-specific code.

### Why Async Init?

Some platforms (like Node.js) need to dynamically import modules like `AsyncLocalStorage`. The `init()` method lets us handle this gracefully:

```typescript
// In NodePlatformAdapter
async init() {
  this.alsClass = await loadAsyncLocalStorageClass();
}
```

### Why Return Cleanup Functions?

Every event listener registration returns a cleanup function:

```typescript
onUncaughtException(handler) {
  process.on("uncaughtException", handler);
  return () => process.off("uncaughtException", handler); // ✨
}
```

**Benefit:** No memory leaks, easy testing, and proper cleanup during shutdown.

### The "Fail Gracefully" Philosophy

When a feature isn't available, we don't crash - we throw informative errors:

```typescript
exit() {
  throw new PlatformUnsupportedFunction("exit");
}
```

This lets developers know _why_ something failed and what runtime features they're missing.

## 🎯 Real-World Benefits

### For Library Authors

- Write once, run everywhere
- No runtime-specific imports in your main code
- Bundle optimizers can tree-shake unused platform code

### For Application Developers

- Same API whether you're building for Node.js, browsers, or edge workers
- Gradual adoption - migrate one runtime at a time
- Testing is consistent across all platforms

### For Framework Maintainers

- Single codebase to maintain
- Easy to add new runtime support
- Clear separation of concerns

## 🚀 Adding New Platforms

Want to support a new runtime? Just implement the interface:

```typescript
export class DenoEdgePlatformAdapter implements IPlatformAdapter {
  async init() {
    // Deno-specific initialization
  }

  onUncaughtException(handler) {
    // Use Deno's error handling
    globalThis.addEventListener("error", handler);
    return () => globalThis.removeEventListener("error", handler);
  }

  getEnv(key: string) {
    return Deno.env.get(key);
  }

  // ... implement the rest
}
```

Then add it to the detection logic and build config. That's it!

## 🎉 Conclusion

The multi-platform architecture might seem complex, but it solves a real problem: **JavaScript fragmentation**. By abstracting platform differences behind a clean interface, we can:

- Maintain a single codebase
- Provide runtime-optimized bundles
- Support new platforms easily
- Give developers a consistent experience

The key insight is that **dependency injection has universal concepts** (lifecycle, error handling, environment access) but **platform-specific implementations**. Our adapter pattern bridges this gap elegantly.

Next time you see code like `getPlatform().onShutdownSignal(handler)`, you'll know there's a sophisticated system making sure it works whether you're running in Node.js, a browser, or the next JavaScript runtime that gets invented!

_Happy coding! 🚀_

## 🧪 Testing & Coverage Strategy (What We Practiced)

Achieving reliable 100% coverage across Node, Browser, and Universal adapters requires a pragmatic test strategy. Here’s what we do and why it works.

### Environments and harnesses

- Node.js paths: run under the default Jest node environment.
- Browser paths: use `@jest-environment jsdom` on tests that need real DOM-like behavior (window/document events).
- Universal paths: exercise the delegating adapter and generic-universal adapter in plain node, simulating globals as needed.

### Test the contract, not internals

- Always go through the public interface (`IPlatformAdapter`) and its methods:
  - error/unhandledrejection listeners: register, trigger, dispose
  - shutdown signals: beforeunload + visibilitychange
  - environment access: getEnv fallbacks (`__ENV__`, `process.env`, `globalThis.env`)
  - async context: positive in Node (ALS), negative in Browser/Universal generic
  - timers: verify `setTimeout`/`clearTimeout` are exposed

### Deterministic environment simulation

- Prefer surgical, reversible changes to `globalThis` over module patching:
  - Temporarily set or delete `globalThis.window`, `globalThis.document`, `globalThis.addEventListener`, etc.
  - Restore originals in `afterEach`/`finally` blocks to keep tests hermetic.
  - For visibility changes, use a mocked document object with a controllable `visibilityState`.
  - For error/unhandledrejection, capture listener functions via spies and invoke them with realistic event shapes:
    - error: `{ error: Error }` or a bare value
    - unhandledrejection: `{ reason: any }` or bare value

### Cleanup-first philosophy

All registration methods return disposers. Tests should:

- Assert the listener is registered on the right target (window or globalThis fallback).
- Invoke the disposer and assert the correct removal call is issued.

### Handling unreachable branches (coverage without hacks)

- Some branches exist for completeness but are unreachable by construction. Example:
  - In `UniversalPlatformAdapter`, the `switch(kind === "browser")` path is effectively unreachable when the earlier `document/addEventListener` check holds true. We keep the branch to document intent, but exclude it from coverage with `/* istanbul ignore next */` comments.
- Avoid brittle hacks like rewriting module source at runtime or deep prototype overrides to force coverage on unreachable paths.

### Patterns we used in tests

- Browser beforeunload & visibilitychange

  - Mock `window.addEventListener`/`removeEventListener` and stash handlers to invoke them synchronously.
  - Provide a `document` mock with `visibilityState = "hidden"` to trigger the visibility handler.

- Error/unhandledrejection handling

  - Register handlers via the adapter, then call captured listeners with shapes `{ error: Error }` or `{ reason: value }` to validate unwrapping paths.

- Timers exposure

  - Call `adapter.setTimeout(fn, ms)` and immediately `adapter.clearTimeout(id)` to ensure bindings are wired and execute without throwing.

- AsyncLocalStorage
  - Node: calling `createAsyncLocalStorage` before `init()` throws an informative error; after `init()`, `run/getStore` work via the loaded ALS class.
  - Browser/Universal generic: `hasAsyncLocalStorage()` is false, and `createAsyncLocalStorage().getStore/run` throw `PlatformUnsupportedFunction`.

### Build-target tests and factory behavior

- The factory leverages a build-time `__TARGET__` constant to short-circuit detection and emit optimal bundles (`node`, `browser`, `edge`, `universal`).
- Tests validate that the factory yields the expected adapter per target and that delegation is intact.

### What to avoid (brittleness checklist)

- Don’t monkey-patch compiled source files or ESM internals to coerce a branch.
- Don’t override class prototypes to force impossible switch cases.
- Don’t rely on non-deterministic global timing or browser features not modeled by JSDOM.

### CI and quality gates

- 100% global thresholds enforced (statements, branches, functions, lines).
- `npm run coverage` is the canonical command; it’s fast and deterministic.
- If a branch is provably unreachable by design, prefer an `istanbul ignore` with a short comment rather than brittle tests.

### Minimal examples

Error listener (browser):

```ts
const adapter = new BrowserPlatformAdapter();
const listeners: Record<string, Function> = {};

(globalThis as any).window = {
  addEventListener: (evt: string, fn: Function) => (listeners[evt] = fn),
  removeEventListener: jest.fn(),
};

const spy = jest.fn();
const dispose = adapter.onUncaughtException(spy);

// triggers handler(e?.error ?? e)
listeners["error"]?.({ error: new Error("boom") });
dispose();
```

Beforeunload + cleanup:

```ts
const adapter = new BrowserPlatformAdapter();
const win = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
} as any;
(globalThis as any).window = win;

const handler = jest.fn();
const dispose = adapter.onShutdownSignal(handler);

const before = win.addEventListener.mock.calls.find(
  (c: any[]) => c[0] === "beforeunload",
)?.[1];
before?.();
expect(handler).toHaveBeenCalled();
dispose();
```

Universal adapter note (coverage):

```ts
// The "browser" case inside the switch is kept for completeness but marked:
// istanbul ignore next — unreachable when document/addEventListener are present
```

With these practices, we maintain a stable, high-fidelity test suite that reflects real platform behavior while still achieving strict 100% coverage.
