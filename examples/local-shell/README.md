# Local Runtime Shell

Start a Runner app, then attach a separate terminal to its live container. Requires Node.js 22+ on Unix (Linux or macOS). From the repository root, build once:

```sh
npm run build
```

Start the app:

```sh
TERM=xterm-256color node examples/local-shell/app.mjs
```

In another terminal:

```sh
node examples/local-shell/shell.mjs
```

Try these commands at the prompt:

```js
await runtime.runTask("app.tasks.increment", { amount: 2 })
const counter = runtime.getResourceValue("app.counter")
counter.value
await runtime.getHealth()
```

Variables survive between commands. Press Up/Down for session history, Tab for completion, and use `.exit` to disconnect while leaving the app running. Commands operate on live application state.

## Connect Through SSH

With the app already running on the remote host, run the connector there as the same OS user:

```sh
ssh -t app@server 'cd /srv/my-app && node examples/local-shell/shell.mjs'
```

Only SSH crosses the network. The connector reaches a local Unix socket; Runner opens no TCP or HTTP listener. `-t` allocates the terminal needed for input editing.

The application uses an owner-only directory under the OS temporary directory. The connector and app must resolve the same path. Production applications should choose a stable private directory and use its absolute socket path in both scripts.

See [Runtime Shell](../../readmes/RUNTIME_SHELL.md) for lifecycle, access, and evaluation details.
