import type { AsyncLocalStorage } from "node:async_hooks";
import { bindShellRuntime } from "./context";
import { scopeShellSession } from "./sessionScope";
import type { Socket } from "node:net";
import { start } from "node:repl";
import type { RunResult } from "../../models/RunResult";

export function startShellSession(
  socket: Socket,
  runtime: RunResult<unknown>,
  scope: AsyncLocalStorage<boolean>,
  readOnly: boolean,
): void {
  socket.write(
    `Runner shell | ${runtime.root.id} | pid ${process.pid}\nLive application access. .exit disconnects; .help lists commands.\n`,
  );
  const session = start({
    prompt: readOnly ? "runner[read-only]> " : "runner> ",
    input: socket,
    output: socket,
    terminal: true,
    useGlobal: false,
    // Do not speculatively evaluate live application expressions while typing.
    preview: false,
    useColors: false,
    ignoreUndefined: true,
  });
  scopeShellSession(session, socket, runtime, scope, readOnly);
  const bindRuntime = () => bindShellRuntime(session, runtime);
  bindRuntime();
  session.on("reset", bindRuntime);
  session.on("error", () => socket.destroy());
  session.once("exit", () => socket.end());
  socket.once("close", () => session.close());
}
