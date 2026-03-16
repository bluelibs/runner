import type { RunResult } from "../models/RunResult";
import { snapshotActiveRunResults } from "./activeRunResults";

export async function __disposeActiveRunResultsForTests(): Promise<void> {
  await __disposeActiveRunResultsForTestsExcept();
}

export function __snapshotActiveRunResultsForTests(): ReadonlySet<
  RunResult<any>
> {
  return snapshotActiveRunResults();
}

export async function __disposeActiveRunResultsForTestsExcept(
  keep: ReadonlySet<RunResult<any>> = new Set(),
): Promise<void> {
  await Promise.all(
    Array.from(snapshotActiveRunResults())
      .filter((runtime) => !keep.has(runtime))
      .map(async (runtime) => {
        try {
          await runtime.dispose();
        } catch {
          // Best-effort cleanup in tests; preserve original test failure surface.
        }
      }),
  );
}
