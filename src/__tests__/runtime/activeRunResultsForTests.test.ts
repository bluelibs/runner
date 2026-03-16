import type { RunResult } from "../../models/RunResult";
import {
  registerActiveRunResult,
  snapshotActiveRunResults,
  unregisterActiveRunResult,
} from "../../runtime/activeRunResults";
import {
  __disposeActiveRunResultsForTests,
  __disposeActiveRunResultsForTestsExcept,
  __snapshotActiveRunResultsForTests,
} from "../../runtime/activeRunResultsForTests";

function createTrackedRuntime(options?: {
  disposeImpl?: () => Promise<void>;
}): RunResult<any> {
  const runtime = {
    dispose: jest.fn(async () => {
      try {
        await options?.disposeImpl?.();
      } finally {
        unregisterActiveRunResult(runtime);
      }
    }),
  } as unknown as RunResult<any>;

  return runtime;
}

describe("activeRunResultsForTests", () => {
  it("keeps snapshots isolated from later registry changes", () => {
    const runtime = createTrackedRuntime();

    registerActiveRunResult(runtime);
    const snapshot = snapshotActiveRunResults();
    unregisterActiveRunResult(runtime);

    expect(snapshot.has(runtime)).toBe(true);
    expect(snapshotActiveRunResults().has(runtime)).toBe(false);
  });

  it("disposes only runtimes created after the kept snapshot", async () => {
    const keptRuntime = createTrackedRuntime();
    registerActiveRunResult(keptRuntime);

    const keep = __snapshotActiveRunResultsForTests();

    const disposableRuntime = createTrackedRuntime();
    registerActiveRunResult(disposableRuntime);

    await __disposeActiveRunResultsForTestsExcept(keep);

    expect(keptRuntime.dispose).not.toHaveBeenCalled();
    expect(disposableRuntime.dispose).toHaveBeenCalledTimes(1);

    unregisterActiveRunResult(keptRuntime);
  });

  it("swallows disposal errors while still attempting cleanup", async () => {
    const failingRuntime = createTrackedRuntime({
      disposeImpl: async () => {
        throw new Error("dispose failed");
      },
    });
    registerActiveRunResult(failingRuntime);

    await expect(__disposeActiveRunResultsForTests()).resolves.toBeUndefined();
  });
});
