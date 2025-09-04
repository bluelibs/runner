# Universal BlueLibs Runner Examples

This directory contains examples showing how BlueLibs Runner works across different environments after de-nodification.

## Examples

- `node-server.js` - Traditional Node.js server usage
- `browser-app.html` - Browser application using the same API
- `edge-function.js` - Cloudflare Workers/Edge runtime example
- `universal-example.js` - Code that works in all environments

## Key Features

### Same API Everywhere

```javascript
import { run, resource, task } from "@bluelibs/runner";

// This exact code works in Node.js, browsers, edge runtimes, etc.
const myResource = resource({
  id: "shared-resource",
  init: async () => ({ message: "Hello Universal!" }),
});

const result = await run(myResource);
```

### Platform-Specific Adaptations

- **Node.js**: Full process management, real AsyncLocalStorage
- **Browser**: beforeunload handling, AsyncLocalStorage polyfill
- **Edge**: Web API compatible, no process exit

### Zero Configuration

No need for different imports or configuration - the package automatically detects the runtime and adapts accordingly.
