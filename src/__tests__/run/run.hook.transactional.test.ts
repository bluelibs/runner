import { defineEvent, defineHook, defineResource } from "../../define";
import { run } from "../../run";
import { RunnerMode } from "../../types/runner";

describe("run transactional hooks", () => {
  it("rolls back transactional hooks in reverse order and reports failing hook id", async () => {
    const steps: string[] = [];
    const txEvent = defineEvent<void>({
      id: "run.tx.event.rollback",
      transactional: true,
    });

    const hook1 = defineHook({
      id: "run.tx.hook.one",
      on: txEvent,
      order: 0,
      run: async () => {
        steps.push("hook-1");
        return async () => {
          steps.push("undo-1");
        };
      },
    });

    const hook2 = defineHook({
      id: "run.tx.hook.two",
      on: txEvent,
      order: 1,
      run: async () => {
        steps.push("hook-2");
        return async () => {
          steps.push("undo-2");
        };
      },
    });

    const hookFail = defineHook({
      id: "run.tx.hook.fail",
      on: txEvent,
      order: 2,
      run: async () => {
        steps.push("hook-fail");
        throw new Error("hook failure");
      },
    });

    const app = defineResource({
      id: "run.tx.app.rollback",
      register: [txEvent, hook1, hook2, hookFail],
      init: async () => "ok",
    });

    const runtime = await run(app, { mode: RunnerMode.TEST });

    try {
      await runtime.emitEvent(txEvent, undefined);
      fail("Expected transactional hook failure");
    } catch (error: unknown) {
      const normalized = error as { message?: string; listenerId?: string };
      expect(normalized.message ?? "").toContain("hook failure");
      expect(normalized.listenerId ?? "").toContain("run.tx.hook.fail");
    } finally {
      await runtime.dispose();
    }

    expect(steps).toEqual([
      "hook-1",
      "hook-2",
      "hook-fail",
      "undo-2",
      "undo-1",
    ]);
  });

  it("enforces runtime undo rule for wildcard hooks when a transactional event is emitted", async () => {
    const seen: string[] = [];
    const nonTransactionalEvent = defineEvent<void>({
      id: "run.tx.runtime.non-tx",
    });
    const transactionalEvent = defineEvent<void>({
      id: "run.tx.runtime.tx",
      transactional: true,
    });

    const wildcardHook = defineHook({
      id: "run.tx.runtime.wildcard",
      on: "*",
      run: async (event) => {
        seen.push(event.id);
      },
    });

    const app = defineResource({
      id: "run.tx.runtime.app",
      register: [nonTransactionalEvent, transactionalEvent, wildcardHook],
      init: async () => "ok",
    });

    const runtime = await run(app, { mode: RunnerMode.TEST });

    await expect(
      runtime.emitEvent(nonTransactionalEvent, undefined),
    ).resolves.toBeUndefined();

    await expect(
      runtime.emitEvent(transactionalEvent, undefined),
    ).rejects.toMatchObject({
      id: "runner.errors.transactionalMissingUndoClosure",
      listenerId: expect.stringContaining("run.tx.runtime.wildcard"),
    });

    expect(seen).toEqual(
      expect.arrayContaining(["run.tx.runtime.non-tx", "run.tx.runtime.tx"]),
    );
    await runtime.dispose();
  });

  it("skips hook self-emitted events by source id to avoid re-entry", async () => {
    const seen: string[] = [];
    const loopEvent = defineEvent<void>({
      id: "run.tx.runtime.self-source",
    });

    const selfEmittingHook = defineHook({
      id: "run.tx.runtime.self-source.hook",
      on: loopEvent,
      dependencies: { loopEvent },
      run: async (_event, deps) => {
        seen.push("hook-ran");
        await deps.loopEvent(undefined);
      },
    });

    const app = defineResource({
      id: "run.tx.runtime.self-source.app",
      register: [loopEvent, selfEmittingHook],
      init: async () => "ok",
    });

    const runtime = await run(app, { mode: RunnerMode.TEST });
    await runtime.emitEvent(loopEvent, undefined);
    await runtime.dispose();

    expect(seen).toEqual(["hook-ran"]);
  });
});
