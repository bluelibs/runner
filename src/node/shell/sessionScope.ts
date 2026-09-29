import type { AsyncLocalStorage } from "node:async_hooks";
import type { AsyncCompleter } from "node:readline";
import type { REPLEval, REPLServer } from "node:repl";
import type { Socket } from "node:net";
import type { RunResult } from "../../models/RunResult";
import { RuntimeLifecyclePhase } from "../../models/runtime/LifecycleAdmissionController";

export function acceptsShellCommands(runtime: RunResult<unknown>): boolean {
  const phase = runtime.store.getLifecycleAdmissionController().getPhase();
  return (
    phase === RuntimeLifecyclePhase.Running ||
    phase === RuntimeLifecyclePhase.Paused
  );
}

export function scopeShellSession(
  session: REPLServer,
  socket: Socket,
  runtime: RunResult<unknown>,
  scope: AsyncLocalStorage<boolean>,
  readOnly: boolean,
): void {
  const run = <T>(callback: () => T): T | undefined => {
    if (!acceptsShellCommands(runtime)) {
      socket.destroy();
      return;
    }
    return scope.run(readOnly || scope.getStore() === true, callback);
  };
  // Keep Node's evaluator (including native top-level await), adding only scope.
  const evaluate = session.eval;
  const scopedEval: REPLEval = (...args) => {
    run(() => evaluate.apply(session, args));
  };
  const complete = session.completer;
  const scopedCompleter: AsyncCompleter = (line, callback) => {
    run(() => Reflect.apply(complete, session, [line, callback]));
  };
  Object.defineProperty(session, "eval", { value: scopedEval });
  Object.defineProperty(session, "completer", { value: scopedCompleter });
}
