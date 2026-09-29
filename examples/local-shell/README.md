# Local Runtime Shell

Start a Runner app, then attach a separate terminal to its live container. Requires Node.js 22+ on Unix (Linux or macOS). From the repository root, build once:

```sh
npm run build
```

Start the app:

```sh
node examples/local-shell/app.mjs
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

Try `.tasks`, `.resources counter`, and `.status` to discover the app and inspect the session. Terminal capabilities are detected by the connector; the app needs no `TERM` setup.

Variables survive between commands. Press Up/Down for session history, Tab for completion, and use `.exit` to disconnect while leaving the app running. Commands operate on live application state.

## Opt Into Persistent History

Create an owner-only directory and select an explicit history file:

```sh
mkdir -m 700 "$HOME/.runner-shell"
node examples/local-shell/shell.mjs --history-file "$HOME/.runner-shell/history.jsonl"
```

Up/Down can now recall commands after reconnecting. Without this option, history stays in memory. Commands beginning with a space are omitted from the file; use this for lines that contain secrets. When connecting through SSH, the history path is on the application host. `--run` never writes history.

## Run One Command

```sh
node examples/local-shell/shell.mjs --read-only --run 'await runtime.getHealth()'
ssh app@server 'cd /srv/my-app && node examples/local-shell/shell.mjs --read-only --run "await runtime.getHealth()"'
```

`--run` prints captured console output and the final value, then disconnects. It supports `await`, needs no TTY or `TERM` setting, and exits with status 1 if evaluation fails. Omit `--read-only` to allow writes through the guarded counter resource. Each invocation has fresh session variables and operates on the existing app.

## Read-Only Session

```sh
node examples/local-shell/shell.mjs --read-only
```

The counter resource depends on `resources.shell` and checks `shell.isReadOnly()` inside `increment()`. Reads still work; both task-based and direct increments throw. The guard uses the current async execution scope, so ordinary application work remains writable. The shell itself does not sandbox JavaScript or automatically protect other resources.

## Connect Through SSH

With the app already running on the remote host, run the connector there as the same OS user:

```sh
ssh -t app@server 'cd /srv/my-app && node examples/local-shell/shell.mjs --read-only'
```

Only SSH crosses the network. The connector reaches a local Unix socket; Runner opens no TCP or HTTP listener. `-t` allocates the terminal needed for input editing.

The application uses an owner-only directory under the OS temporary directory. The connector and app must resolve the same path. Production applications should choose a stable private directory and use its absolute socket path in both scripts.

See [Runtime Shell](../../readmes/RUNTIME_SHELL.md) for lifecycle, access, and evaluation details.

The example uses an explicit private directory so it works from a shared checkout. In an owner-only working directory, you can instead register `resources.shell` without `.with(...)`, call `connectShell()` without options, or call `runShell({ command: "42" })`. Both sides default to `runner.sock` in their own current directory. Start the SSH connector from the same app directory. Stale sockets are reclaimed automatically; live listeners and non-socket paths are preserved and cause startup to fail.
