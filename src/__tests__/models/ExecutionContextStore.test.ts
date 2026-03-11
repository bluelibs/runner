import {
  ExecutionContextStore,
  recordExecutionContext,
} from "../../models/ExecutionContextStore";
import {
  EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
  type ExecutionFrame,
} from "../../types/executionContext";
import { runtimeSource } from "../../types/runtimeSource";
import { PlatformAdapter, resetPlatform, setPlatform } from "../../platform";

function makeFrame(
  kind: "task" | "event" | "hook",
  id: string,
): ExecutionFrame {
  return {
    kind,
    id,
    source: runtimeSource.runtime(`test-${id}`),
    timestamp: Date.now(),
  };
}

describe("ExecutionContextStore", () => {
  afterEach(() => {
    resetPlatform();
  });

  describe("disabled (null config)", () => {
    it("isEnabled is false when config is null", () => {
      const ctx = new ExecutionContextStore(null);
      expect(ctx.isEnabled).toBe(false);
    });

    it("runWithFrame passes through when disabled", () => {
      const ctx = new ExecutionContextStore(null);
      const result = ctx.runWithFrame(makeFrame("task", "t1"), () => 42);
      expect(result).toBe(42);
    });

    it("getSnapshot returns undefined when disabled", () => {
      const ctx = new ExecutionContextStore(null);
      expect(ctx.getSnapshot()).toBeUndefined();
    });

    it("returns the wrapped result when async local storage is unavailable", () => {
      setPlatform(new PlatformAdapter("universal"));
      const ctx = new ExecutionContextStore({
        maxDepth: 2,
        maxRepetitions: 2,
      });

      expect(ctx.isEnabled).toBe(false);
      expect(ctx.runWithFrame(makeFrame("task", "t1"), () => 42)).toBe(42);
    });

    it("clears inherited async context when execution context is disabled inside an active execution", () => {
      const enabled = new ExecutionContextStore(
        EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
      );
      const disabled = new ExecutionContextStore(null);

      enabled.runWithFrame(makeFrame("task", "outer"), () => {
        expect(enabled.getSnapshot()?.currentFrame.id).toBe("outer");

        disabled.runWithFrame(makeFrame("task", "inner"), () => {
          expect(enabled.getSnapshot()).toBeUndefined();
          expect(disabled.getSnapshot()).toBeUndefined();
        });

        expect(enabled.getSnapshot()?.currentFrame.id).toBe("outer");
      });
    });
  });

  describe("enabled", () => {
    it("isEnabled is true with valid config", () => {
      const ctx = new ExecutionContextStore(
        EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
      );
      expect(ctx.isEnabled).toBe(true);
    });

    it("getSnapshot returns undefined outside any frame", () => {
      const ctx = new ExecutionContextStore(
        EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
      );
      expect(ctx.getSnapshot()).toBeUndefined();
    });

    it("tracks a single frame", () => {
      const ctx = new ExecutionContextStore(
        EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
      );
      ctx.runWithFrame(makeFrame("task", "t1"), () => {
        const snapshot = ctx.getSnapshot();
        expect(snapshot).toBeDefined();
        expect(snapshot!.depth).toBe(1);
        expect(snapshot!.frames[0].kind).toBe("task");
        expect(snapshot!.frames[0].id).toBe("t1");
      });
    });

    it("tracks nested frames (task -> event -> hook)", () => {
      const ctx = new ExecutionContextStore(
        EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
      );
      ctx.runWithFrame(makeFrame("task", "t1"), () => {
        ctx.runWithFrame(makeFrame("event", "e1"), () => {
          ctx.runWithFrame(makeFrame("hook", "h1"), () => {
            const snapshot = ctx.getSnapshot()!;
            expect(snapshot.depth).toBe(3);
            expect(snapshot.frames.map((f) => f.kind)).toEqual([
              "task",
              "event",
              "hook",
            ]);
          });
        });
      });
    });

    it("returns async results from runWithFrame", async () => {
      const ctx = new ExecutionContextStore(
        EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
      );
      const result = await ctx.runWithFrame(
        makeFrame("task", "t1"),
        async () => "async-result",
      );
      expect(result).toBe("async-result");
    });

    it("falls back when crypto.randomUUID is unavailable for legacy configs", () => {
      const originalCrypto = globalThis.crypto;
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        configurable: true,
      });

      const ctx = new ExecutionContextStore({
        maxDepth: 10,
        maxRepetitions: 10,
      });

      ctx.runWithFrame(makeFrame("task", "t1"), () => {
        expect(ctx.getSnapshot()!.correlationId).toMatch(/^exec-/);
      });

      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    });

    it("reuses the outer recording and correlation id for nested record calls", async () => {
      const ctx = new ExecutionContextStore(
        EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
      );

      const outer = await recordExecutionContext(
        { correlationId: "outer-correlation" },
        () =>
          recordExecutionContext({ correlationId: "inner-correlation" }, () =>
            ctx.runWithFrame(makeFrame("task", "t1"), () => "ok"),
          ),
      );

      expect(outer.recording?.correlationId).toBe("outer-correlation");
      expect(outer.recording?.roots[0]?.frame.id).toBe("t1");
      expect(outer.result.recording?.correlationId).toBe("outer-correlation");
    });

    it("records failed status for synchronous throws inside a recording", async () => {
      const ctx = new ExecutionContextStore(
        EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
      );

      await expect(
        recordExecutionContext({ correlationId: "sync-failure" }, () =>
          ctx.runWithFrame(makeFrame("task", "t1"), () => {
            throw new Error("sync boom");
          }),
        ),
      ).rejects.toThrow("sync boom");
    });
  });

  describe("depth limit", () => {
    it("throws executionDepthExceededError when max depth is reached", () => {
      const ctx = new ExecutionContextStore({
        maxDepth: 3,
        maxRepetitions: 100,
      });
      expect(() => {
        ctx.runWithFrame(makeFrame("task", "t1"), () => {
          ctx.runWithFrame(makeFrame("event", "e1"), () => {
            ctx.runWithFrame(makeFrame("hook", "h1"), () => {
              // 4th frame exceeds maxDepth=3
              ctx.runWithFrame(makeFrame("task", "t2"), () => {});
            });
          });
        });
      }).toThrow(/trace exceeded/i);
    });

    it("allows execution up to exactly maxDepth", () => {
      const ctx = new ExecutionContextStore({
        maxDepth: 3,
        maxRepetitions: 100,
      });
      ctx.runWithFrame(makeFrame("task", "t1"), () => {
        ctx.runWithFrame(makeFrame("event", "e1"), () => {
          ctx.runWithFrame(makeFrame("hook", "h1"), () => {
            // 3 frames exactly — should work
            expect(ctx.getSnapshot()!.depth).toBe(3);
          });
        });
      });
    });
  });

  describe("repetition-based cycle detection", () => {
    it("throws executionCycleError when same kind+id reaches threshold", () => {
      const ctx = new ExecutionContextStore({
        maxDepth: 100,
        maxRepetitions: 2,
      });
      expect(() => {
        ctx.runWithFrame(makeFrame("event", "e1"), () => {
          ctx.runWithFrame(makeFrame("hook", "h1"), () => {
            // 2nd appearance of event:e1 triggers cycle (maxRepetitions=2)
            ctx.runWithFrame(makeFrame("event", "e1"), () => {});
          });
        });
      }).toThrow(/cycle detected/i);
    });

    it("allows same kind+id below threshold", () => {
      const ctx = new ExecutionContextStore({
        maxDepth: 100,
        maxRepetitions: 4,
      });
      ctx.runWithFrame(makeFrame("event", "e1"), () => {
        ctx.runWithFrame(makeFrame("hook", "h1"), () => {
          ctx.runWithFrame(makeFrame("event", "e1"), () => {
            // 2 appearances with maxRepetitions=4 — allowed
            expect(ctx.getSnapshot()!.depth).toBe(3);
          });
        });
      });
    });

    it("different kind same id does not count as repetition", () => {
      const ctx = new ExecutionContextStore({
        maxDepth: 100,
        maxRepetitions: 2,
      });
      ctx.runWithFrame(makeFrame("task", "shared-id"), () => {
        ctx.runWithFrame(makeFrame("event", "shared-id"), () => {
          ctx.runWithFrame(makeFrame("hook", "shared-id"), () => {
            // Same id but different kinds — no cycle
            expect(ctx.getSnapshot()!.depth).toBe(3);
          });
        });
      });
    });

    it("includes trace data in cycle error", () => {
      const ctx = new ExecutionContextStore({
        maxDepth: 100,
        maxRepetitions: 2,
      });
      try {
        ctx.runWithFrame(makeFrame("event", "e1"), () => {
          ctx.runWithFrame(makeFrame("hook", "h1"), () => {
            ctx.runWithFrame(makeFrame("event", "e1"), () => {});
          });
        });
        throw new Error("should have thrown");
      } catch (error: any) {
        expect(error.data.frame.kind).toBe("event");
        expect(error.data.frame.id).toBe("e1");
        expect(error.data.repetitions).toBe(2);
        expect(error.data.maxRepetitions).toBe(2);
        expect(error.data.trace.length).toBe(2);
      }
    });

    it("includes correct depth in depth-exceeded error", () => {
      const ctx = new ExecutionContextStore({
        maxDepth: 2,
        maxRepetitions: 100,
      });
      try {
        ctx.runWithFrame(makeFrame("task", "t1"), () => {
          ctx.runWithFrame(makeFrame("event", "e1"), () => {
            ctx.runWithFrame(makeFrame("hook", "h1"), () => {});
          });
        });
        throw new Error("should have thrown");
      } catch (error: any) {
        expect(error.data.currentDepth).toBe(2);
        expect(error.data.maxDepth).toBe(2);
      }
    });
  });

  describe("isolation between runs", () => {
    it("execution context is empty after runWithFrame completes", () => {
      const ctx = new ExecutionContextStore(
        EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
      );
      ctx.runWithFrame(makeFrame("task", "t1"), () => {
        expect(ctx.getSnapshot()!.depth).toBe(1);
      });
      // Outside the frame — should be undefined
      expect(ctx.getSnapshot()).toBeUndefined();
    });
  });
});
