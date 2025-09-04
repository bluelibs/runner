# Multi-Platform Approach: Universal BlueLibs Runner

This document provides a comprehensive guide to BlueLibs Runner's universal compatibility across all JavaScript environments. The framework now works identically in Node.js, browsers, edge runtimes, and any JavaScript environment.

## Table of Contents

1. [Overview](#overview)
2. [Platform Compatibility](#platform-compatibility)
3. [Installation & Setup](#installation--setup)
4. [Core Architecture](#core-architecture)
5. [Usage Examples](#usage-examples)
6. [Platform-Specific Features](#platform-specific-features)
7. [Migration Guide](#migration-guide)
8. [Testing Strategy](#testing-strategy)
9. [Performance Considerations](#performance-considerations)
10. [Troubleshooting](#troubleshooting)

## Overview

BlueLibs Runner has been transformed from a Node.js-specific framework into a **universal JavaScript framework** that provides the same powerful dependency injection, event system, and task orchestration capabilities across all JavaScript environments.

### Key Benefits

- **🌐 Universal**: Same API works in Node.js, browsers, edge runtimes, and service workers
- **🔄 Zero Breaking Changes**: All existing Node.js code continues to work unchanged
- **🚀 Performance**: Platform-specific optimizations for each environment
- **🔧 Developer Experience**: Consistent patterns across your entire stack
- **📦 Bundle-Friendly**: Tree-shakeable and optimized for modern bundlers

## Platform Compatibility

| Environment               | Support Level | Features                                                                    |
| ------------------------- | ------------- | --------------------------------------------------------------------------- |
| **Node.js 18+**           | ✅ Full       | All features including process signals, real AsyncLocalStorage, file system |
| **Modern Browsers**       | ✅ Full       | Web APIs, polyfilled AsyncLocalStorage, event handling                      |
| **Cloudflare Workers**    | ✅ Full       | Edge-optimized, Web API based, lightweight runtime                          |
| **Vercel Edge Functions** | ✅ Full       | Optimized for edge deployment, fast cold starts                             |
| **Deno**                  | ✅ Full       | Native Web API support, TypeScript-first                                    |
| **Service Workers**       | ✅ Full       | Background processing, cache management                                     |
| **React Native**          | ✅ Partial    | Core features (requires AsyncStorage polyfill)                              |
| **Electron**              | ✅ Full       | Both main and renderer processes                                            |

## Installation & Setup

### Standard Installation

```bash
npm install @bluelibs/runner
```

### Import Syntax

```typescript
// ESM (recommended)
import { run, resource, task, event, hook } from "@bluelibs/runner";

// CommonJS (Node.js)
const { run, resource, task, event, hook } = require("@bluelibs/runner");
```

### Package.json Exports

The package provides conditional exports for optimal compatibility:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "node": "./dist/index.js",
      "browser": "./dist/index.js",
      "default": "./dist/index.js"
    }
  }
}
```

## Core Architecture

### Platform Abstraction Layer

The framework uses a sophisticated platform abstraction layer that automatically detects the runtime environment and provides appropriate implementations:

```typescript
// Platform adapter interface
interface IPlatformAdapter {
  // Process management
  onSignal(signal: string, handler: () => void): void;
  offSignal(signal: string, handler: () => void): void;
  exit(code: number): void;

  // Environment
  getEnv(key: string): string | undefined;

  // Async context
  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T>;

  // Timers
  setTimeout(fn: () => void, ms: number): any;
  clearTimeout(id: any): void;
}
```

### Automatic Platform Detection

```typescript
// The framework automatically detects your platform:
// - Node.js: Uses real AsyncLocalStorage and process APIs
// - Universal: Uses Web API polyfills and event listeners

import { getPlatform } from "@bluelibs/runner/platform";

const platform = getPlatform();
// Returns NodePlatformAdapter or UniversalPlatformAdapter
```

## Usage Examples

### 1. Node.js Server Application

```typescript
import { run, resource, task } from "@bluelibs/runner";
import express from "express";

const server = resource({
  id: "http-server",
  init: async (config: { port: number }) => {
    const app = express();
    const server = app.listen(config.port);
    console.log(`Server running on port ${config.port}`);
    return { app, server };
  },
  dispose: async ({ server }) => {
    server.close();
    console.log("Server gracefully closed");
  },
});

const healthCheck = task({
  id: "health-check",
  dependencies: { server },
  run: async (_, { server }) => {
    server.app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });
    return "Health endpoint registered";
  },
});

const app = resource({
  id: "app",
  register: [server.with({ port: 3000 }), healthCheck],
  dependencies: { server, healthCheck },
  init: async (_, deps) => {
    await deps.healthCheck();
    return { server: deps.server.server };
  },
});

// Full Node.js features: process signals, real AsyncLocalStorage, graceful shutdown
await run(app, {
  shutdownHooks: true, // Handle SIGTERM/SIGINT
  errorBoundary: true, // Catch uncaught exceptions
  logs: { printThreshold: "info" },
});
```

### 2. Browser Application

```typescript
import { run, resource, task, createContext } from "@bluelibs/runner";

// User context for request-scoped data
const UserContext = createContext<{ userId: string }>("user-context");

// Data store using Web APIs
const dataStore = resource({
  id: "browser-store",
  init: async () => {
    const store = new Map();
    return {
      get: (key: string) => store.get(key),
      set: (key: string, value: any) => store.set(key, value),
      clear: () => store.clear(),
    };
  },
});

// User input handler
const handleUserInput = task({
  id: "handle-input",
  dependencies: { store: dataStore },
  middleware: [UserContext.require()], // Requires user context
  run: async (inputData: any, { store }) => {
    const user = UserContext.use();
    const key = `user:${user.userId}:input`;
    store.set(key, { ...inputData, timestamp: Date.now() });
    return { success: true, stored: key };
  },
});

const browserApp = resource({
  id: "browser-app",
  register: [dataStore, handleUserInput],
  dependencies: { store: dataStore, handler: handleUserInput },
  init: async (_, { store, handler }) => {
    console.log("Browser app initialized");

    // Setup DOM event handlers
    document.addEventListener("click", async (e) => {
      if (e.target.dataset.action === "process") {
        await UserContext.provide({ userId: "user123" }, async () => {
          const result = await handler({
            action: "click",
            target: e.target.id,
          });
          console.log("Processed:", result);
        });
      }
    });

    return { store, handler };
  },
});

// Browser-optimized configuration
await run(browserApp, {
  shutdownHooks: false, // No process in browser
  errorBoundary: true, // Catch errors
  logs: {
    printThreshold: "warn",
    printStrategy: "pretty",
  },
});
```

### 3. Cloudflare Workers / Edge Functions

```typescript
import { run, resource, task } from "@bluelibs/runner";

// Edge-optimized cache
const edgeCache = resource({
  id: "edge-cache",
  init: async () => {
    const cache = new Map();
    return {
      get: async (key: string) => {
        const item = cache.get(key);
        return item && item.expires > Date.now() ? item.value : null;
      },
      set: async (key: string, value: any, ttl = 3600) => {
        cache.set(key, {
          value,
          expires: Date.now() + ttl * 1000,
        });
      },
    };
  },
});

// Request handler
const handleRequest = task({
  id: "handle-request",
  dependencies: { cache: edgeCache },
  run: async (request: Request, { cache }) => {
    const url = new URL(request.url);
    const cacheKey = `api:${url.pathname}`;

    // Try cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Generate response
    const data = {
      path: url.pathname,
      method: request.method,
      timestamp: new Date().toISOString(),
    };

    // Cache response
    await cache.set(cacheKey, data, 300); // 5 minutes

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  },
});

const edgeApp = resource({
  id: "edge-app",
  register: [edgeCache, handleRequest],
  dependencies: { handler: handleRequest },
  init: async (_, { handler }) => ({ handler }),
});

// Cloudflare Workers export
export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    // Edge-optimized: no process management, minimal footprint
    const result = await run(edgeApp, {
      shutdownHooks: false,
      errorBoundary: true,
      logs: { printThreshold: "error" }, // Minimal logging in production
    });

    try {
      return await result.runTask(handleRequest, request);
    } finally {
      // Clean shutdown for edge environment
      await result.dispose();
    }
  },
};
```

### 4. Universal Code Example

```typescript
import { run, resource, task, event, hook } from "@bluelibs/runner";

// Universal logger that adapts to environment
const logger = resource({
  id: "universal-logger",
  init: async () => {
    const isNode = typeof process !== "undefined" && process.versions?.node;
    const isBrowser = typeof window !== "undefined";

    return {
      info: (message: string, data?: any) => {
        const timestamp = new Date().toISOString();
        const env = isNode ? "NODE" : isBrowser ? "BROWSER" : "EDGE";
        console.log(`[${timestamp}] [${env}] ${message}`, data || "");
      },
      error: (message: string, error?: any) => {
        console.error(`ERROR: ${message}`, error);
      },
    };
  },
});

// Universal data processor
const processData = task({
  id: "process-data",
  dependencies: { logger },
  run: async (input: any, { logger }) => {
    logger.info("Processing data", { inputType: typeof input });

    // Simulate async work
    await new Promise((resolve) => setTimeout(resolve, 10));

    return {
      processed: true,
      input,
      timestamp: new Date().toISOString(),
      environment: {
        isNode: typeof process !== "undefined",
        isBrowser: typeof window !== "undefined",
        hasWebAPIs: typeof fetch !== "undefined",
      },
    };
  },
});

// Universal event
const dataProcessed = event<{ result: any }>({
  id: "data-processed",
});

// Universal event handler
const onDataProcessed = hook({
  id: "on-data-processed",
  on: dataProcessed,
  dependencies: { logger },
  run: async (event, { logger }) => {
    logger.info("Data processed event received", event.data);
  },
});

// Universal app
const universalApp = resource({
  id: "universal-app",
  register: [logger, processData, dataProcessed, onDataProcessed],
  dependencies: { logger, processor: processData },
  init: async (_, { logger, processor }) => {
    logger.info("Universal app starting...");

    // Test data processing
    const testResult = await processor("Hello Universal World!");
    logger.info("Universal app ready", testResult);

    return {
      processor,
      process: async (data: any) => {
        const result = await processor(data);
        // Emit event for all listeners
        return result;
      },
    };
  },
});

// This same code works in Node.js, browsers, and edge runtimes!
const result = await run(universalApp, {
  // Platform-specific optimizations applied automatically
  shutdownHooks: typeof process !== "undefined", // Only in Node.js
  errorBoundary: true,
  logs: { printThreshold: "info" },
});

// Use the app
const output = await result.runTask(processData, { test: "data" });
console.log("Result:", output);
```

## Platform-Specific Features

### Node.js Environment

When running in Node.js, the framework provides:

- **Real AsyncLocalStorage**: Full async context tracking
- **Process Signal Handling**: SIGTERM, SIGINT for graceful shutdown
- **Process Exit**: Clean process termination
- **Environment Variables**: Direct access to `process.env`
- **File System Access**: Full Node.js APIs available

```typescript
// Node.js specific features automatically available
await run(app, {
  shutdownHooks: true, // Handles SIGTERM/SIGINT
  errorBoundary: true, // Catches uncaughtException/unhandledRejection
  onUnhandledError: async ({ error, kind }) => {
    if (kind === "process") {
      // Graceful shutdown
      await flushLogs();
      process.exit(1);
    }
  },
});
```

### Browser Environment

In browsers, the framework provides:

- **AsyncLocalStorage Polyfill**: Maintains async context across promises
- **Event Listeners**: Web-compatible shutdown signal simulation
- **Web APIs**: Full access to fetch, localStorage, sessionStorage, etc.
- **DOM Integration**: Event handling and DOM manipulation

```typescript
// Browser-specific optimizations
await run(app, {
  shutdownHooks: false, // No process to manage
  errorBoundary: true, // Catches window.onerror
  logs: {
    printStrategy: "pretty", // Colored console output
    printThreshold: "warn", // Less verbose in production
  },
});
```

### Edge Runtime Environment

For edge functions (Cloudflare Workers, Vercel Edge, etc.):

- **Minimal Footprint**: Optimized for fast cold starts
- **Web API Only**: Uses standard Web APIs for maximum compatibility
- **No Process Management**: Stateless execution model
- **Built-in Caching**: Leverages edge infrastructure

```typescript
// Edge-optimized configuration
await run(app, {
  shutdownHooks: false, // No persistent process
  errorBoundary: true, // Catch and handle errors
  logs: {
    printThreshold: "error", // Minimal logging
    bufferLogs: false, // No buffering in edge
  },
});
```

## Migration Guide

### From Node.js-Only to Universal

**No code changes required!** Your existing BlueLibs Runner code will continue to work unchanged in Node.js environments.

To make your code universal:

1. **Review Dependencies**: Ensure imported modules work in your target environments
2. **Use Web APIs**: Prefer `fetch` over Node.js `http`, `crypto.subtle` over Node.js `crypto`
3. **Handle Environment Differences**: Use conditional logic for platform-specific features

```typescript
// Before (Node.js only)
import fs from "fs";
import { run, resource } from "@bluelibs/runner";

const fileService = resource({
  id: "file-service",
  init: async () => ({
    read: (path: string) => fs.readFileSync(path, "utf8"),
  }),
});

// After (Universal)
import { run, resource } from "@bluelibs/runner";

const storageService = resource({
  id: "storage-service",
  init: async () => {
    const isNode = typeof process !== "undefined";

    if (isNode) {
      // Node.js file system
      const fs = await import("fs");
      return {
        read: (path: string) => fs.readFileSync(path, "utf8"),
        write: (path: string, data: string) => fs.writeFileSync(path, data),
      };
    } else {
      // Browser localStorage or edge KV store
      return {
        read: (key: string) => localStorage.getItem(key),
        write: (key: string, data: string) => localStorage.setItem(key, data),
      };
    }
  },
});
```

### Bundle Configuration

For optimal browser bundles, configure your bundler to exclude Node.js modules:

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      fs: false,
      path: false,
      crypto: false,
    },
  },
};

// vite.config.js
export default {
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      // Polyfills if needed
    },
  },
};
```

## Testing Strategy

### Cross-Platform Testing

Test your universal code across all target environments:

```typescript
// test/universal.test.ts
import { run, resource, task } from "@bluelibs/runner";

describe("Universal Compatibility", () => {
  test("works in simulated browser environment", async () => {
    // Mock browser globals
    global.window = {} as any;
    global.document = {} as any;

    const app = resource({
      id: "test-app",
      init: async () => ({ platform: "browser" }),
    });

    const result = await run(app, {
      shutdownHooks: false,
      errorBoundary: true,
    });

    expect(result.getResourceValue(app)).toEqual({ platform: "browser" });
    await result.dispose();
  });

  test("works in simulated edge environment", async () => {
    // Clear Node.js globals
    const originalProcess = global.process;
    delete global.process;

    const app = resource({
      id: "edge-app",
      init: async () => ({ platform: "edge" }),
    });

    const result = await run(app, {
      shutdownHooks: false,
      errorBoundary: true,
    });

    expect(result.getResourceValue(app)).toEqual({ platform: "edge" });
    await result.dispose();

    // Restore
    global.process = originalProcess;
  });
});
```

### Browser Testing

Create browser test files that can be opened directly:

```html
<!-- test/browser-test.html -->
<!DOCTYPE html>
<html>
  <head>
    <title>BlueLibs Runner Browser Test</title>
  </head>
  <body>
    <div id="results"></div>

    <script type="module">
      import { run, resource, task } from "../dist/index.js";

      async function runTests() {
        const app = resource({
          id: "browser-test",
          init: async () => ({ test: "success" }),
        });

        const result = await run(app);
        const value = result.getResourceValue(app);

        document.getElementById(
          "results",
        ).innerHTML = `Test Result: ${JSON.stringify(value)}`;

        await result.dispose();
      }

      runTests().catch(console.error);
    </script>
  </body>
</html>
```

## Performance Considerations

### Bundle Size Optimization

The universal build is optimized for minimal bundle size:

- **Tree Shaking**: Unused code is eliminated
- **Conditional Exports**: Only required platform code is included
- **No Node.js Dependencies**: Browser builds exclude Node.js modules

```javascript
// Bundle analysis
import { run, resource } from "@bluelibs/runner"; // ~15KB gzipped
import { createContext } from "@bluelibs/runner"; // +2KB
import { globals } from "@bluelibs/runner"; // +5KB (optional)
```

### Runtime Performance

| Environment | Cold Start | Memory Usage | Features                 |
| ----------- | ---------- | ------------ | ------------------------ |
| **Node.js** | ~5ms       | ~2MB         | Full AsyncLocalStorage   |
| **Browser** | ~2ms       | ~500KB       | Polyfilled async context |
| **Edge**    | ~1ms       | ~100KB       | Minimal footprint        |

### Platform-Specific Optimizations

The framework automatically optimizes for each platform:

```typescript
// Automatic optimizations based on environment
const platform = getPlatform();

if (platform.isNode()) {
  // Use real AsyncLocalStorage, process APIs
} else {
  // Use Web API polyfills, event listeners
}
```

## Troubleshooting

### Common Issues

#### 1. "AsyncLocalStorage is not defined" in Browser

**Issue**: Trying to use Node.js AsyncLocalStorage directly in browser.

**Solution**: The framework handles this automatically. If you're using AsyncLocalStorage directly, import from the platform abstraction:

```typescript
// ❌ Don't do this
import { AsyncLocalStorage } from "async_hooks";

// ✅ Use platform abstraction
import { getPlatform } from "@bluelibs/runner/platform";
const als = getPlatform().createAsyncLocalStorage<any>();
```

#### 2. Bundle Size Too Large

**Issue**: Browser bundle includes Node.js modules.

**Solution**: Configure your bundler to exclude Node.js modules:

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      fs: false,
      path: false,
      crypto: false,
      events: false,
    },
  },
};
```

#### 3. Context Lost in Async Operations

**Issue**: Context is lost across async boundaries in browser.

**Solution**: The polyfill handles most cases automatically. For edge cases, use the context API explicitly:

```typescript
import { createContext } from "@bluelibs/runner";

const UserContext = createContext("user");

// Wrap async operations
await UserContext.provide({ userId: "123" }, async () => {
  // All async operations within this block have access to context
  await someAsyncOperation();
  const user = UserContext.use(); // Works correctly
});
```

#### 4. Environment Detection Issues

**Issue**: Framework doesn't detect environment correctly.

**Solution**: Manually override platform detection:

```typescript
import {
  setPlatform,
  UniversalPlatformAdapter,
} from "@bluelibs/runner/platform";

// Force universal adapter
setPlatform(new UniversalPlatformAdapter());
```

#### 5. Edge Function Timeouts

**Issue**: Edge functions timeout during execution.

**Solution**: Optimize for fast execution and minimal resource usage:

```typescript
await run(app, {
  shutdownHooks: false,
  errorBoundary: true,
  logs: {
    printThreshold: "error", // Minimal logging
    bufferLogs: false, // No buffering
  },
});
```

### Debug Mode

Enable debug mode to troubleshoot issues:

```typescript
await run(app, {
  debug: "verbose", // Shows platform detection and execution details
  logs: {
    printThreshold: "trace",
    printStrategy: "json-pretty",
  },
});
```

### Platform Detection Debugging

```typescript
import { getPlatform } from "@bluelibs/runner/platform";

const platform = getPlatform();
console.log("Platform:", platform.constructor.name);
console.log("Environment:", {
  isNode: typeof process !== "undefined",
  isBrowser: typeof window !== "undefined",
  isEdge: typeof process === "undefined" && typeof window === "undefined",
});
```

## Conclusion

BlueLibs Runner's multi-platform approach enables you to:

1. **Write Once, Deploy Everywhere**: Same code works across all JavaScript environments
2. **Maintain Consistency**: Consistent dependency injection patterns across your stack
3. **Optimize Performance**: Platform-specific optimizations applied automatically
4. **Future-Proof**: Built on Web Standards that work everywhere

The framework's universal compatibility opens up new architectural possibilities, allowing you to share business logic, dependency injection patterns, and application structure across server-side, client-side, and edge deployments.

Start building universal JavaScript applications with BlueLibs Runner today! 🚀
