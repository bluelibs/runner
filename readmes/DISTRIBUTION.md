# Channel Feature: Execution Plan

This document outlines the execution plan for the "Channel" feature, which enables tasks to be executed across different processes or services. This plan uses an idiomatic, tag-based, and type-safe design for discovery, configuration, and inversion of control.

## 1. Goals

- **Seamless Integration:** Distributing a task should feel like a natural extension of the framework, using familiar primitives like resources, tags, and hooks.
- **Type-Safe & Decoupled:** Eliminate string-based links in favor of direct, type-safe references for linking tasks to channels.
- **Dynamic Configuration:** Allow channel configuration (e.g., URLs, ports, mode) to be determined dynamically at runtime.
- **Executor-First Model:** The remote process (the "executor") runs the complete task chain, including all its middleware.
- **Streaming Support:** Natively support streaming for file uploads and downloads.

## 2. Core Primitives

### `defineChannel` Tag (for Resources)

A tag to identify a `resource` as a "Channel Manager". It holds the static, unique ID for the channel.

```typescript
import { tag } from "@bluelibs/runner";

const defineChannel = tag<{ id: string }>({ id: "channel.define" });
```

### `useChannel` Tag (for Tasks)

A tag for `task` definitions that links them to a specific Channel Manager via a direct, type-safe resource reference. It also holds task-specific remote execution options.

```typescript
import { tag, IResource } from "@bluelibs/runner";

const useChannel = tag<{
  channel: IResource<any, any>;
  isQuery?: boolean;
  concurrency?: number;
  timeout?: number;
  cache?: { ttl: number };
}>({ id: "channel.use" });
```

### Channel Wiring Hook

A global `hook` that listens for the `globals.events.ready` event. It runs after all resources are initialized and is responsible for the final wiring: discovering all channels and tasks, and then either starting servers or applying client-side interceptors.

## 3. API and Architecture

````typescript
import {
  resource,
  task,
  tag,
  hook,
  globals,
  IResource,
  run,
} from "@bluelibs/runner";
import { getDetectedEnvironment } from "@bluelibs/runner/platform";

// The shape of the configuration that a Channel Manager resource must return.
type ChannelMode = "client" | "server" | "auto";

interface IHttpClientConfig {
  url: string;
}

interface IHttpServerConfig {
  port: number;
  host?: string;
}

type ServerConfigLazy<T> = T | (() => Promise<T>);

interface IChannelConfig {
  // 'auto' lets the wiring choose based on runtime (server vs browser)
  mode: ChannelMode;
  client?: {
    transport: {
      http: IHttpClientConfig;
    };
  };
  server?: ServerConfigLazy<{
    transport: {
      http: IHttpServerConfig;
    };
  }>;
}

// 1. Define the tags
const defineChannel = tag<{ id: string }>({ id: "channel.define" });
const useChannel = tag<{
  channel: IResource<any, any>;
  isQuery?: boolean;
  concurrency?: number;
  timeout?: number;
  cache?: { ttl: number };
}>({ id: "channel.use" });

// 2. Define the Channel Manager Resource
const imageProcChannel = resource({
  id: "app.channels.image-processors",
  tags: [defineChannel.with({ id: "image-processors" })],
  // This resource's `init` method dynamically provides the channel's configuration.
  init: async (): Promise<IChannelConfig> => {
    return {
      mode: (process.env.IMG_APP_MODE as ChannelMode) || "auto",
      client: {
        transport: {
          http: {
            url: process.env.IMAGE_PROC_URL || "http://localhost:4001",
          },
        },
      },
      // Make server config lazy to keep server-only deps out of browser bundles
      server: async () => ({
        transport: {
          http: {
            port: parseInt(process.env.IMAGE_PROC_PORT || "4001", 10),
            host: process.env.IMAGE_PROC_HOST || "0.0.0.0",
          },
        },
      }),
    };
  },
});

// 3. Define a Task that uses the channel via a type-safe reference
const makeThumbnails = task({
  id: "app.tasks.makeThumbnails",
  tags: [
    useChannel.with({
      channel: imageProcChannel,
      isQuery: false, // This is a POST request
    }),
  ],
  run: async (input) => {
    /* This logic only runs on the server */
  },
});

// 4. Define the Global Wiring Hook
const channelWiringHook = hook({
  id: "core.hooks.channel-wiring",
  on: globals.events.ready,
  dependencies: { store: globals.resources.store },
  run: async (_, { store }) => {
    const channelManagers = store.getResourcesWithTag(defineChannel);
    const channelTasks = store.getTasksWithTag(useChannel);

    for (const managerDef of channelManagers) {
      const config = store.getResourceValue<IChannelConfig>(managerDef);
      const tasksForThisChannel = channelTasks.filter((taskDef) => {
        const cfg = useChannel.extract(taskDef);
        return cfg?.channel?.id === managerDef.id;
      });

  // Decide effective mode when set to 'auto' using platform detection (node/edge treated as server)
  const env = getDetectedEnvironment();
  const isServerEnv = env === "node" || env === "edge";
  const effectiveMode = config.mode === "auto" ? (isServerEnv ? "server" : "client") : config.mode;

      if (effectiveMode === "server") {
        const serverCfg = typeof config.server === "function" ? await config.server() : config.server;
        if (!serverCfg) continue;
        // Logic to start an HTTP server for tasksForThisChannel at serverCfg.transport.http
      } else {
        const clientCfg = config.client;
        if (!clientCfg) continue;
        // Logic to apply interceptors to tasksForThisChannel using clientCfg.transport.http
      }
    }
  },
});

// 5. Register all components in the main app resource
const app = resource({
  id: "app",
  register: [imageProcChannel, makeThumbnails, channelWiringHook],
});

### DX: Single declaration for client + server

Use `mode: "auto"` and split config into `client` and lazy `server` so you declare once and it works in both environments. Keep any server-only code inside the lazy `server` function to avoid bundling it in the browser.

```ts
const imageProcChannel = resource({
  id: "app.channels.image-processors",
  tags: [defineChannel.with({ id: "image-processors" })],
  init: async (): Promise<IChannelConfig> => ({
    mode: "auto",
    client: {
      transport: { http: { url: process.env.IMAGE_PROC_URL || "http://localhost:4001" } },
    },
    server: async () => ({
      transport: { http: { port: Number(process.env.IMAGE_PROC_PORT || 4001), host: process.env.IMAGE_PROC_HOST || "0.0.0.0" } },
    }),
  }),
});
````

await run(app);

````

## 4. Streaming Implementation

(No changes from previous plan, this remains a solid approach)

### Input Streaming (File Uploads)

A task declares its intent to receive a stream via its `inputSchema`.

```ts
import { Readable } from "stream";
import { z } from "zod";

const makeThumbnails = task({
  // ...
  inputSchema: z.object({
    image: z.instanceof(Readable),
    width: z.number(),
  }),
  // ...
});
````

### Output Streaming (File Downloads)

A task that returns a Node.js `Readable` (`stream.Readable`) will have its result streamed back to the client.

## 5. EJSON and Stream Integration

To handle both complex data types and large file streams simultaneously, the Channel feature uses a hybrid `multipart/form-data` request model. This allows us to get the benefits of EJSON's rich type support for metadata and the efficiency of streaming for file data.

### How it Works

When a distributed task is called, the client-side interceptor intelligently constructs the request:

1.  **EJSON Payload Part**: All arguments that are _not_ streams (e.g., strings, numbers, objects, `Date` objects) are bundled together and serialized into a single string using `@bluelibs/ejson`. This string is sent in a form part named `payload`.

2.  **Stream Parts**: Each argument that is a `ReadableStream` (or a `File` in the browser) is appended to the form as a separate part. The name of the part corresponds to the argument name (e.g., `image`).

### Example Request Flow

Consider a call: `makeThumbnails({ image: fileStream, options: { timestamp: new Date() } })`

1.  **Client Creates Request**:

    - The `options` object is serialized: `EJSON.stringify({ options: { timestamp: ... } })`.
    - A `FormData` object is created.
    - `formData.append('payload', ...ejsonString...)`
    - `formData.append('image', fileStream)`
    - The `fetch` request is sent with this `FormData` body.

2.  **Server Parses Request**:
    - The server receives the multipart request.
    - It finds and parses the `payload` part using `EJSON.parse()`, correctly reconstructing the `options` object with its `Date`.
    - It finds the `image` part and gets a `ReadableStream` for the file upload.
    - It assembles the final arguments object and calls the local task.

This approach ensures that all data is transmitted with maximum fidelity and efficiency. Task results are handled symmetrically: if the result is a stream, it's sent as raw binary; otherwise, it's serialized with EJSON.

## 6. Execution Plan

### Phase 1: Core Primitives (Est: 1 day)

- [ ] Implement the `defineChannel` tag definition.
- [ ] Implement the `useChannel` tag definition.
- [ ] Define the `IChannelConfig` interface.

### Phase 2: Wiring Hook and Discovery (Est: 2 days)

- [ ] Implement the `channelWiringHook`.
- [ ] Inside the hook, implement the discovery logic to find all channel managers and their associated tasks.
- [ ] Add logging to verify that the correct tasks are being associated with each channel manager.

### Phase 3: Server-Side Implementation (Est: 3 days)

- [ ] In the wiring hook, implement the `server` mode logic.
- [ ] This logic will dynamically start an HTTP server (e.g., using `express`) for each channel manager in server mode.
- [ ] Create a dynamic endpoint (e.g., `/run/:taskId`) that maps to the discovered tasks for that channel.
- [ ] Implement request parsing for `application/json` and `multipart/form-data` payloads, including EJSON deserialization.
- [ ] Implement error serialization.

### Phase 4: Client-Side Implementation (Est: 3 days)

- [ ] In the wiring hook, implement the `client` mode logic.
- [ ] This logic will iterate through the discovered tasks for a client channel and apply a `task.intercept()` to each.
- [ ] The interceptor will prevent local execution and instead construct and send an HTTP request to the channel's configured URL, using EJSON and multipart as needed.
- [ ] Implement response handling for both EJSON results, raw streams, and serialized errors.

### Phase 5: Advanced Features (Est: 2 days)

- [ ] Implement `isQuery` logic to use `GET` requests for idempotent tasks.
- [ ] Implement remote `cache`, `timeout`, and `concurrency` options from the `useChannel` tag.

### Phase 6: Documentation & Testing (Est: 3 days)

- [ ] Create a new, comprehensive example project in the `/examples` directory.
- [ ] Write unit and integration tests covering all aspects of the new design.
- [ ] Update `README.md` and `AI.md` to reflect the new Channel feature.
