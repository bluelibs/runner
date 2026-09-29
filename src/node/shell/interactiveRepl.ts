import { env } from "node:process";
import { Interface } from "node:readline";
import { REPLServer, type ReplOptions } from "node:repl";
import { check } from "../../tools/check";

/** Keeps Node's editor and await handling, independent of the service's TERM. */
export function createInteractiveRepl(options: ReplOptions): REPLServer {
  const descriptor = Object.getOwnPropertyDescriptor(
    Interface.prototype,
    "_ttyWrite",
  );
  const nativeWrite: unknown = descriptor?.value;
  check(nativeWrite, Function);
  let write = nativeWrite;
  let skipServiceDumbWriter = env.TERM === "dumb";
  // Node exports the constructor at runtime; its typings restrict callers to start().
  const Constructor = REPLServer as unknown as new (
    options: ReplOptions,
  ) => REPLServer;
  class SessionREPL extends Constructor {}
  // Node installs a dumb writer before wrapping it for editor mode and pending
  // awaits. Intercept only that first assignment on this session's prototype.
  Object.defineProperty(SessionREPL.prototype, "_ttyWrite", {
    get: () => write,
    set(value: unknown) {
      if (skipServiceDumbWriter) {
        skipServiceDumbWriter = false;
        return;
      }
      write = value;
    },
  });
  return new SessionREPL(options);
}
