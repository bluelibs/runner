import { contextError } from "../errors";
import { getPlatform } from "../platform";
import { ResolvedRunOptions } from "../types/runner";

export function assertExecutionContextSupport(
  executionContext: ResolvedRunOptions["executionContext"],
): void {
  if (!executionContext) {
    return;
  }

  if (!getPlatform().hasAsyncLocalStorage()) {
    contextError.throw({
      details:
        "Execution context requires AsyncLocalStorage and is not available in this environment.",
    });
  }
}
