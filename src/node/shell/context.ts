import type { REPLServer } from "node:repl";
import type { RunResult } from "../../models/RunResult";

export function bindShellRuntime(
  session: REPLServer,
  runtime: RunResult<unknown>,
): void {
  // Values constructed by the evaluator must match application-side class schemas.
  Object.assign(session.context, { Date, Map, Set, RegExp });
  Object.defineProperty(session.context, "runtime", {
    value: runtime,
    enumerable: true,
    configurable: true,
  });
}
