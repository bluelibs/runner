import { ExecutionContextStore } from "../../models/ExecutionContextStore";
import { EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS } from "../../types/executionContext";
import { runtimeSource } from "../../types/runtimeSource";

function makeTaskFrame(id: string) {
  return {
    kind: "task" as const,
    id,
    source: runtimeSource.runtime(`test-${id}`),
    timestamp: Date.now(),
  };
}

describe("ExecutionContextStore signal inheritance", () => {
  it("stores the first signal on the execution tree and keeps it for nested frames", () => {
    const ctx = new ExecutionContextStore(
      EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
    );
    const firstController = new AbortController();
    const secondController = new AbortController();

    ctx.runWithFrame(
      makeTaskFrame("root"),
      () => {
        expect(ctx.getSnapshot()?.signal).toBe(firstController.signal);

        ctx.runWithFrame(
          makeTaskFrame("child"),
          () => {
            expect(ctx.getSnapshot()?.signal).toBe(firstController.signal);
          },
          { signal: secondController.signal },
        );
      },
      { signal: firstController.signal },
    );
  });

  it("runWithSignal seeds the current frame once and does not override it later", () => {
    const ctx = new ExecutionContextStore(
      EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
    );
    const inheritedController = new AbortController();
    const ignoredController = new AbortController();

    ctx.runWithFrame(makeTaskFrame("root"), () => {
      expect(ctx.getSnapshot()?.signal).toBeUndefined();

      ctx.runWithSignal(inheritedController.signal, () => {
        expect(ctx.getSnapshot()?.signal).toBe(inheritedController.signal);

        ctx.runWithSignal(ignoredController.signal, () => {
          expect(ctx.getSnapshot()?.signal).toBe(inheritedController.signal);
        });
      });
    });
  });
});
