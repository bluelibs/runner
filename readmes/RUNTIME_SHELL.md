# Runtime Shell

Register `resources.shell` to inspect and operate a running Runner app from a terminal. `connectShell()` attaches to that container over a Unix domain socket. It does not start another app or open an HTTP or TCP listener.

This is an opt-in Node.js 22+ administrative resource for Linux and macOS. Register it only when you want trusted local operators to execute JavaScript with the application's privileges. Windows named pipes are not supported.

## Register The Shell

Use a private directory owned by the application's OS user. Create it before booting the app; the resource rejects missing directories, group/other permissions, and a symlink as the immediate parent.

```ts
import { mkdir } from "node:fs/promises";
import { r, resources, run } from "@bluelibs/runner/node";

await mkdir("/run/my-app", { mode: 0o700, recursive: true });

const app = r
  .resource("app")
  .register([
    resources.shell.with({ socketPath: "/run/my-app/runner.sock" }),
  ])
  .build();

await run(app);
```

For a service deployment, provision `/run/my-app` with mode `0700` and the service user's ownership instead of creating it in application code. Use a separate socket path for each container or replica. Paths must be absolute, at most 103 UTF-8 bytes, and contain no NUL character.

The shell starts listening during its resource's `ready` lifecycle. During cooldown it disconnects clients and closes the listener. Disposal also closes it, including startup rollback. Node removes the socket on a normal close; the private directory remains. Existing socket paths are never removed to make room for a listener. If a process crashes and leaves a stale socket, verify the old process is gone before removing it.

## Connect From A Script

Create `shell.mjs` next to your application:

```js
import { connectShell } from "@bluelibs/runner/node";

await connectShell({
  socketPath: "/run/my-app/runner.sock",
  readOnly: process.argv.includes("--read-only"),
});
```

Run it from another terminal:

```sh
node shell.mjs
```

A TypeScript connector can use the same code in `shell.ts`, executed with your project's TypeScript runner. Both terminal input and output must be TTY streams. The connector restores the input's original raw mode when the connection closes and does not close your terminal streams.

## Work With The Live App

The shell binds `runtime` to the same container-scoped handle returned by `run(app)`. The prompt identifies the app's root id and process id. For the [runnable counter example](../examples/local-shell/README.md):

```js
await runtime.runTask("app.tasks.increment", { amount: 2 })
const counter = runtime.getResourceValue("app.counter")
counter.value
await runtime.getHealth()
```

Use canonical ids: the resource is `app.counter`; the task is `app.tasks.increment`. Runtime access checks still apply to these methods. Task calls use Runner's normal validation, middleware, and execution pipeline. Calling a resource's methods directly does not run task middleware. No tenant or user context is inferred from the SSH user.

The evaluator is [Node's native JavaScript REPL](https://nodejs.org/docs/latest-v22.x/api/repl.html), including its top-level `await` semantics. Input is JavaScript, even when the connector script is TypeScript. Session variables survive between commands and are private to that connection; resources remain shared with the live app. Disconnecting discards session variables.

`Date`, `Map`, `Set`, and `RegExp` use application-side constructors so instances created with `new` pass class schemas. For a `RegExp` class schema, use `new RegExp(...)`; regular-expression literals retain the REPL VM's prototype.

| Input | Behavior |
| --- | --- |
| Up / Down | Navigate this session's command history |
| Tab | Native JavaScript completion |
| An incomplete expression | Continue input over multiple lines |
| `.editor` | Enter multiline editor mode; Ctrl+D submits |
| `.clear` | Reset session variables and rebind `runtime` |
| `.help` | Show Node REPL commands |
| `.exit` or Ctrl+D at an empty prompt | Disconnect without disposing the app |

History is not persisted to disk. Native line editing follows the application process's `TERM` setting. If your service starts with `TERM=dumb`, launch it with `TERM=xterm-256color` to enable arrow keys and completion.

## Connect Through SSH

Keep the listener local. Use SSH to run the connector on the same machine, under the OS user that owns the socket directory:

```sh
ssh -t app@server 'cd /srv/my-app && node shell.mjs'
```

`-t` allocates a terminal, so history, completion, and line editing work. There is no Runner network port to forward. SSH authenticates the remote session; filesystem permissions restrict access to the socket.

For multiple replicas, select the host/container and socket explicitly. Session state belongs to one process and does not move between replicas.

## Run One Command

Use `runShell()` for scripts and SSH commands that should print a result and exit. It connects to the same registered resource and does not require a TTY or `TERM` configuration:

```js
import { parseArgs } from "node:util";
import { connectShell, runShell } from "@bluelibs/runner/node";

const { values } = parseArgs({ options: {
  run: { type: "string" },
  "read-only": { type: "boolean", default: false },
} });
const options = {
  socketPath: "/run/my-app/runner.sock",
  readOnly: values["read-only"],
};
if (values.run !== undefined) {
  const result = await runShell({ ...options, command: values.run });
  process.stdout.write(result.output);
  process.exitCode = result.success ? 0 : 1;
} else {
  await connectShell(options);
}
```

Save this as `shell.mjs`, then run it locally or through SSH:

```sh
node shell.mjs --read-only --run 'await runtime.getHealth()'
ssh app@server 'cd /srv/my-app && node shell.mjs --read-only --run "await runtime.getHealth()"'
```

SSH runs the connector on the app host; no port forwarding is required. Interactive sessions still use `ssh -t`, while one-shot commands work without `-t` and can redirect their output to a file.

`command` is one JavaScript evaluation, including native top-level `await`, declarations, and multiline source. Output combines `console.log`, `console.error`, and the final value in order, with no banner or prompt. An `undefined` final value adds no output. Results are buffered until evaluation finishes. Logging performed by existing application resources keeps its normal destinations; the connector captures the shell’s console, not the whole process. Each command gets fresh session variables while sharing the live app's resources.

Failures reported by the native REPL return `{ success: false, output }`; connection and protocol failures reject the promise. Reject promises with `Error` objects: Node’s native evaluator can treat an awaited rejection with a falsy reason, such as `Promise.reject(null)`, as successful evaluation. The script above exits with status 1 on evaluation failure, which SSH propagates to the caller. Dot commands such as `.exit` are interactive-only. The JSON-encoded connection request, including source, is limited to 64 KiB. Disconnecting does not cancel arbitrary JavaScript already running; awaiting an unresolved promise can keep a command pending.

## Opt Into Read-Only Access

Choose the mode when connecting:

```sh
node shell.mjs --read-only
ssh -t app@server 'cd /srv/my-app && node shell.mjs --read-only'
```

`connectShell({ socketPath, readOnly: true })` negotiates the mode before attaching terminal input. The prompt becomes `runner[read-only]>`. The mode stays fixed for the connection, including after `.clear`. Both options default to `false`; registering `resources.shell.with({ socketPath, readOnly: true })` requires read-only mode for every connection, even if the connector requests writable access. Incompatible protocol versions fail before terminal input is forwarded.

Resources enforce this policy at their operation boundary. Here is a complete in-memory database example; a real adapter checks the same method before issuing writes:

```ts
import { r, resources, run } from "@bluelibs/runner/node";

const writeDenied = r.error("writeDenied")
  .format(() => "This shell is read-only.")
  .build();

const database = r.resource("database")
  .dependencies({ shell: resources.shell })
  .init(async (_, { shell }) => {
    const values = new Map<string, string>();
    return {
      get(key: string) { return values.get(key); },
      set(key: string, value: string) {
        if (shell.isReadOnly()) throw writeDenied.new();
        values.set(key, value);
      },
    };
  })
  .build();

// Provision this directory with mode 0700 before starting the app.
await run(r.resource("app").register([
  database,
  resources.shell.with({ socketPath: "/run/my-app/runner.sock" }),
]).build());
```

Call `shell.isReadOnly()` inside each operation, not once during resource initialization. It reads this container's async execution scope: shell evaluation, completion, awaited work, nested tasks, and timers created in that scope inherit the mode. Ordinary application requests and other containers see `false`; concurrent shell sessions keep their own mode. The shell does not establish another database connection. Your adapter can reject writes or select an existing read-only database client based on this value.

This is cooperative resource policy, not a JavaScript sandbox. A resource that ignores the flag still permits mutations, and raw database clients can bypass wrapper guards. External queues and remote calls do not automatically carry this process-local scope. For database-enforced restrictions, use restricted database credentials or database-specific read-only transactions through your adapter.

## Execution Boundaries

This shell has real application authority. The REPL context separates session variables; it is not a security sandbox. Commands can mutate resources, access Node APIs, or terminate the process. Use `.exit` to leave the shell, not `process.exit()`.

There is no generic dry-run or rollback mode. Disconnecting or resetting a session does not undo changes or reliably cancel work already started. A synchronous infinite loop can block the app's event loop, and a pending promise can keep a command waiting. Use task-specific cancellation and dry-run contracts where needed, or attach to a separate app with test resources.
