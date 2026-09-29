import type { AsyncLocalStorage } from "node:async_hooks";
import type { Socket } from "node:net";
import { start, Recoverable } from "node:repl";
import { PassThrough, Writable } from "node:stream";
import type { RunResult } from "../../models/RunResult";
import { bindShellRuntime } from "./context";
import { scopeShellSession } from "./sessionScope";

export function startShellCommand(
  socket: Socket,
  runtime: RunResult<unknown>,
  scope: AsyncLocalStorage<boolean>,
  readOnly: boolean,
  command: string,
): void {
  const input = new PassThrough();
  const chunks: Buffer[] = [];
  // Disconnecting cannot cancel arbitrary JavaScript; late writes must remain harmless.
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (!socket.destroyed) chunks.push(chunk);
      callback();
    },
  });
  const session = start({
    input,
    output,
    terminal: false,
    prompt: "",
    useGlobal: false,
    preview: false,
    useColors: false,
    ignoreUndefined: true,
  });
  const cleanup = () => {
    session.close();
    input.destroy();
    chunks.length = 0;
  };
  const finish = (success: boolean) => {
    if (socket.destroyed) return;
    const text = Buffer.concat(chunks).toString("utf8");
    cleanup();
    socket.end(JSON.stringify({ success, output: text }));
  };
  socket.once("close", cleanup);
  bindShellRuntime(session, runtime);
  scopeShellSession(session, socket, runtime, scope, readOnly);
  // Native evaluation errors are rendered by the REPL before it requests another prompt.
  session.displayPrompt = () => finish(false);
  session.eval(command, session.context, "runner-shell", (error, value) => {
    if (error) {
      output.write(
        `${session.writer(error instanceof Recoverable ? error.err : error)}\n`,
      );
      finish(false);
      return;
    }
    if (value !== undefined) output.write(`${session.writer(value)}\n`);
    finish(true);
  });
}
