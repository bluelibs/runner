import type { AsyncLocalStorage } from "node:async_hooks";
import { bindShellRuntime } from "./context";
import { scopeShellSession } from "./sessionScope";
import type { Socket } from "node:net";
import { start } from "node:repl";
import { createInteractiveRepl } from "./interactiveRepl";
import { addShellCommands } from "./discovery";
import { openShellHistory } from "./history";
import { acceptsShellCommands } from "./sessionScope";
import type { RunResult } from "../../models/RunResult";

export async function startShellSession(
  socket: Socket,
  runtime: RunResult<unknown>,
  scope: AsyncLocalStorage<boolean>,
  readOnly: boolean,
  terminal = true,
  historyFile?: string,
): Promise<void> {
  const history =
    historyFile === undefined ? undefined : await openShellHistory(historyFile);
  if (socket.destroyed || !acceptsShellCommands(runtime)) {
    await history?.close();
    socket.destroy();
    return;
  }
  try {
    socket.write(
      `Runner shell | ${runtime.root.id} | pid ${process.pid}\nLive application access. .exit disconnects; .help lists commands.\n`,
    );
    const session = (terminal ? createInteractiveRepl : start)({
      prompt: readOnly ? "runner[read-only]> " : "runner> ",
      input: socket,
      output: socket,
      terminal,
      useGlobal: false,
      // Do not speculatively evaluate live application expressions while typing.
      preview: false,
      useColors: false,
      ignoreUndefined: true,
    });
    addShellCommands(session, runtime, readOnly, terminal, historyFile);
    if (history) {
      Reflect.set(session, "history", history.lines);
      session.on("line", (line) => {
        void history.append(line).catch(() => socket.destroy());
      });
    }
    scopeShellSession(session, socket, runtime, scope, readOnly);
    const bindRuntime = () => bindShellRuntime(session, runtime);
    bindRuntime();
    session.on("reset", bindRuntime);
    session.on("error", () => socket.destroy());
    session.once("exit", () => {
      void Promise.resolve(history?.close()).then(
        () => socket.end(),
        () => socket.destroy(),
      );
    });
    socket.once("close", () => {
      session.close();
      void history?.close().catch(() => {});
    });
  } catch (error) {
    await history?.close();
    throw error;
  }
}
