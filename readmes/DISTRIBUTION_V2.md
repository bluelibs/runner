```ts
const imgTunnel = resource({
  tags: [global.tags.tunnel],
  async init() {
    return {
      id: "img-server", // global mode
      currentMode: process.env.IMG_SERVER_MODE || "server", // 'server' or 'client'
      client: {
        url: "http://localhost:4000",
      },
      auth: "key", // or function that returns key for time-support interception
      serializer: JSON, // default
      tasks: [], // or filter(taskDef) => boolean
      allowTaggedTasksOutsideFilter: false, // if true, tasks with the imgTunnel.tag are allowed even if they don't pass the filter
    };
  },
});

const imgTunnelServer = resource({
  tags: [tunnel.server.with({ for: imgTunnel })],
  async init() {
    return HTTPTunnel.open({
      port: 4000,
      auth: (req) => {
        const key = req.headers["x-api-key"];
        if (key !== "key") {
          throw new Error("Unauthorized");
        }
      },
      serializer: JSON,
    });
    // do stuff. open server, get task and input, run it via taskRunner,
    // return result, or error, and make the task throw that actual error. use a safeJsonify.
  },
});

task({
  tags: [
    // optional optimizations
    imgTunnel.tag,
    imgTunnel.tag.with({
      query: true,
      cache: {},
      timeout: {},
      retry: {},
    }),
  ],
});
```

Built-in support for `server` and `client` distribution modes:
