import {
  asyncContexts,
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
  run,
} from "../../public";

describe("Execution context signal inheritance", () => {
  it("inherits the runtime task signal through nested task and event dependencies", async () => {
    const controller = new AbortController();
    let hookSignal: AbortSignal | undefined;
    let hookNestedTaskSignal: AbortSignal | undefined;

    const event = defineEvent<{ userId: string }>({
      id: "signal-inheritance-runtime-event",
    });
    const nestedTask = defineTask({
      id: "signal-inheritance-runtime-nested-task",
      run: async (_input, _deps, context) => context?.signal,
    });
    const hook = defineHook({
      id: "signal-inheritance-runtime-hook",
      on: event,
      dependencies: { nestedTask },
      run: async (emission, { nestedTask: runNestedTask }) => {
        hookSignal = emission.signal;
        hookNestedTaskSignal = await runNestedTask();
      },
    });
    const childTask = defineTask({
      id: "signal-inheritance-runtime-child-task",
      run: async (_input, _deps, context) => context?.signal,
    });
    const parentTask = defineTask({
      id: "signal-inheritance-runtime-parent-task",
      dependencies: { childTask, event },
      run: async (_input, { childTask: runChildTask, event: emitEvent }) => {
        const childSignal = await runChildTask();
        await emitEvent({ userId: "u1" });
        return childSignal;
      },
    });

    const app = defineResource({
      id: "signal-inheritance-runtime-app",
      register: [event, hook, nestedTask, childTask, parentTask],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    await expect(
      runtime.runTask(parentTask, undefined, { signal: controller.signal }),
    ).resolves.toBe(controller.signal);
    expect(hookSignal).toBe(controller.signal);
    expect(hookNestedTaskSignal).toBe(controller.signal);
    await runtime.dispose();
  });

  it("seeds the inherited signal from the first nested task call that provides one", async () => {
    const controller = new AbortController();
    let childSignal: AbortSignal | undefined;

    const grandChildTask = defineTask({
      id: "signal-inheritance-nested-grandchild-task",
      run: async (_input, _deps, context) => context?.signal,
    });
    const childTask = defineTask({
      id: "signal-inheritance-nested-child-task",
      dependencies: { grandChildTask },
      run: async (_input, { grandChildTask: runGrandChildTask }, context) => {
        childSignal = context?.signal;
        return runGrandChildTask();
      },
    });
    const parentTask = defineTask({
      id: "signal-inheritance-nested-parent-task",
      dependencies: { childTask },
      run: async (_input, { childTask: runChildTask }) =>
        runChildTask(undefined, { signal: controller.signal }),
    });

    const app = defineResource({
      id: "signal-inheritance-nested-task-app",
      register: [grandChildTask, childTask, parentTask],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    await expect(runtime.runTask(parentTask)).resolves.toBe(controller.signal);
    expect(childSignal).toBe(controller.signal);
    await runtime.dispose();
  });

  it("seeds the inherited signal from the first nested event emission that provides one", async () => {
    const controller = new AbortController();
    let hookSignal: AbortSignal | undefined;

    const childTask = defineTask({
      id: "signal-inheritance-event-child-task",
      run: async (_input, _deps, context) => context?.signal,
    });
    const event = defineEvent<void>({
      id: "signal-inheritance-nested-event",
    });
    const hook = defineHook({
      id: "signal-inheritance-event-hook",
      on: event,
      dependencies: { childTask },
      run: async (emission, { childTask: runChildTask }) => {
        expect(emission.signal).toBe(controller.signal);
        hookSignal = await runChildTask();
      },
    });
    const parentTask = defineTask({
      id: "signal-inheritance-event-parent-task",
      dependencies: { event },
      run: async (_input, { event: emitEvent }) => {
        await emitEvent(undefined, { signal: controller.signal });
        return "ok";
      },
    });

    const app = defineResource({
      id: "signal-inheritance-event-app",
      register: [childTask, event, hook, parentTask],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    await expect(runtime.runTask(parentTask)).resolves.toBe("ok");
    expect(hookSignal).toBe(controller.signal);
    await runtime.dispose();
  });

  it("does not auto-inherit nested signals when execution context is disabled", async () => {
    const controller = new AbortController();

    const childTask = defineTask({
      id: "signal-inheritance-disabled-child-task",
      run: async (_input, _deps, context) => context?.signal,
    });
    const parentTask = defineTask({
      id: "signal-inheritance-disabled-parent-task",
      dependencies: { childTask },
      run: async (_input, { childTask: runChildTask }) => runChildTask(),
    });

    const app = defineResource({
      id: "signal-inheritance-disabled-app",
      register: [childTask, parentTask],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: false });
    await expect(
      runtime.runTask(parentTask, undefined, { signal: controller.signal }),
    ).resolves.toBeUndefined();
    await runtime.dispose();
  });

  it('keeps signal inheritance working in lightweight "frames: off" mode', async () => {
    const controller = new AbortController();
    let nestedSnapshotFramesMode: "full" | "off" | undefined;

    const childTask = defineTask({
      id: "signal-inheritance-light-child-task",
      run: async (_input, _deps, context) => {
        nestedSnapshotFramesMode = asyncContexts.execution.use().framesMode;
        return context?.signal;
      },
    });
    const parentTask = defineTask({
      id: "signal-inheritance-light-parent-task",
      dependencies: { childTask },
      run: async (_input, { childTask: runChildTask }) => runChildTask(),
    });

    const app = defineResource({
      id: "signal-inheritance-light-app",
      register: [childTask, parentTask],
      init: async () => "ok",
    });

    const runtime = await run(app, {
      executionContext: { frames: "off", cycleDetection: false },
    });
    await expect(
      runtime.runTask(parentTask, undefined, { signal: controller.signal }),
    ).resolves.toBe(controller.signal);
    expect(nestedSnapshotFramesMode).toBe("off");
    await runtime.dispose();
  });

  it("keeps explicit nested signals local while deeper automatic inheritance keeps the ambient one", async () => {
    const outerController = new AbortController();
    const localController = new AbortController();

    const grandChildTask = defineTask({
      id: "signal-inheritance-local-grandchild-task",
      run: async (_input, _deps, context) => context?.signal,
    });
    const childTask = defineTask({
      id: "signal-inheritance-local-child-task",
      dependencies: { grandChildTask },
      run: async (_input, { grandChildTask: runGrandChildTask }, context) => ({
        directSignal: context?.signal,
        nestedSignal: await runGrandChildTask(),
      }),
    });
    const parentTask = defineTask({
      id: "signal-inheritance-local-parent-task",
      dependencies: { childTask },
      run: async (_input, { childTask: runChildTask }) =>
        runChildTask(undefined, { signal: localController.signal }),
    });

    const app = defineResource({
      id: "signal-inheritance-local-app",
      register: [grandChildTask, childTask, parentTask],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    await expect(
      runtime.runTask(parentTask, undefined, {
        signal: outerController.signal,
      }),
    ).resolves.toEqual({
      directSignal: localController.signal,
      nestedSignal: outerController.signal,
    });
    await runtime.dispose();
  });
});
