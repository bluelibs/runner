import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { asyncContexts, resources, run } from "../../public";

describe("Execution Context (integration)", () => {
  it("exposes correlationId and current frame inside task interceptors and task bodies", async () => {
    let interceptorCorrelationId = "";
    let taskCorrelationId = "";

    const task = defineTask({
      id: "execution-context-task",
      run: async () => {
        const executionContext = asyncContexts.execution.use();
        taskCorrelationId = executionContext.correlationId;
        expect(executionContext.framesMode).toBe("full");
        if (executionContext.framesMode !== "full") {
          throw new Error("Expected full execution-context snapshot.");
        }
        expect(executionContext.currentFrame.kind).toBe("task");
        expect(executionContext.currentFrame.id).toBe(
          "execution-context-app.tasks.execution-context-task",
        );
        return executionContext.depth;
      },
    });

    const interceptorResource = defineResource({
      id: "execution-context-interceptor-resource",
      dependencies: { taskRunner: resources.taskRunner },
      init: async (_config, { taskRunner }) => {
        taskRunner.intercept(async (next, input) => {
          const executionContext = asyncContexts.execution.use();
          interceptorCorrelationId = executionContext.correlationId;
          expect(executionContext.framesMode).toBe("full");
          if (executionContext.framesMode !== "full") {
            throw new Error("Expected full execution-context snapshot.");
          }
          expect(executionContext.currentFrame.kind).toBe("task");
          expect(executionContext.currentFrame.id).toBe(
            "execution-context-app.tasks.execution-context-task",
          );
          return next(input);
        });
        return true;
      },
    });

    const app = defineResource({
      id: "execution-context-app",
      register: [task, interceptorResource],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    await expect(runtime.runTask(task)).resolves.toBe(1);
    expect(interceptorCorrelationId).toBe(taskCorrelationId);
    await runtime.dispose();
  });

  it("propagates the same correlationId through task -> event -> hook", async () => {
    const snapshots: Array<{
      kind: string;
      depth: number;
      correlationId: string;
    }> = [];
    const event = defineEvent<string>({ id: "execution-context-event" });

    const hook = defineHook({
      id: "execution-context-hook",
      on: event,
      run: async () => {
        const executionContext = asyncContexts.execution.use();
        if (executionContext.framesMode !== "full") {
          throw new Error("Expected full execution-context snapshot.");
        }
        snapshots.push({
          kind: executionContext.currentFrame.kind,
          depth: executionContext.depth,
          correlationId: executionContext.correlationId,
        });
      },
    });

    const task = defineTask({
      id: "execution-context-emitter-task",
      dependencies: { eventManager: resources.eventManager },
      run: async (_input, { eventManager }) => {
        const executionContext = asyncContexts.execution.use();
        if (executionContext.framesMode !== "full") {
          throw new Error("Expected full execution-context snapshot.");
        }
        snapshots.push({
          kind: executionContext.currentFrame.kind,
          depth: executionContext.depth,
          correlationId: executionContext.correlationId,
        });
        await eventManager.emit(event, "hello", {
          kind: "task",
          id: "execution-context-emitter-task",
        });
      },
    });

    const app = defineResource({
      id: "execution-context-chain-app",
      register: [event, hook, task],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    await runtime.runTask(task);

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toEqual({
      kind: "task",
      depth: 1,
      correlationId: snapshots[1]!.correlationId,
    });
    expect(snapshots[1]).toEqual({
      kind: "hook",
      depth: 3,
      correlationId: snapshots[0]!.correlationId,
    });

    await runtime.dispose();
  });

  it("keeps execution context available when cycle detection is disabled", async () => {
    const task = defineTask({
      id: "execution-context-no-cycles",
      run: async () => asyncContexts.execution.use().correlationId,
    });

    const app = defineResource({
      id: "execution-context-no-cycles-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app, {
      executionContext: { cycleDetection: false },
    });

    await expect(runtime.runTask(task)).resolves.toEqual(expect.any(String));
    await runtime.dispose();
  });

  it("supports lightweight execution context for signal/correlation flows", async () => {
    let seenFramesMode: "full" | "off" | undefined;
    let seenCorrelationId = "";

    const task = defineTask({
      id: "execution-context-light-mode-task",
      run: async () => {
        const executionContext = asyncContexts.execution.use();
        seenFramesMode = executionContext.framesMode;
        seenCorrelationId = executionContext.correlationId;
        expect(executionContext).not.toHaveProperty("currentFrame");
      },
    });

    const app = defineResource({
      id: "execution-context-light-mode-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app, {
      executionContext: { frames: "off", cycleDetection: false },
    });

    await expect(runtime.runTask(task)).resolves.toBeUndefined();
    expect(seenFramesMode).toBe("off");
    expect(seenCorrelationId).toEqual(expect.any(String));
    await runtime.dispose();
  });

  it("provide seeds a custom correlation id for top-level execution", async () => {
    let seenCorrelationId = "";

    const task = defineTask({
      id: "execution-context-provided-task",
      run: async () => {
        seenCorrelationId = asyncContexts.execution.use().correlationId;
      },
    });

    const app = defineResource({
      id: "execution-context-provided-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    await asyncContexts.execution.provide(
      { correlationId: "req-123" },
      async () => runtime.runTask(task),
    );

    expect(seenCorrelationId).toBe("req-123");
    await runtime.dispose();
  });

  it("provide seeds the ambient signal for top-level task execution", async () => {
    const controller = new AbortController();

    const task = defineTask({
      id: "execution-context-provided-signal-task",
      run: async (_input, _deps, context) => context?.signal,
    });

    const app = defineResource({
      id: "execution-context-provided-signal-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    await expect(
      asyncContexts.execution.provide({ signal: controller.signal }, () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe(controller.signal);

    await runtime.dispose();
  });

  it("provide seeds correlation id and signal together for top-level event execution", async () => {
    const controller = new AbortController();
    let seenCorrelationId = "";
    let seenSignal: AbortSignal | undefined;

    const event = defineEvent<void>({
      id: "execution-context-provided-event",
    });
    const hook = defineHook({
      id: "execution-context-provided-event-hook",
      on: event,
      run: async (emission) => {
        const executionContext = asyncContexts.execution.use();
        seenCorrelationId = executionContext.correlationId;
        seenSignal = emission.signal;
      },
    });

    const app = defineResource({
      id: "execution-context-provided-event-app",
      register: [event, hook],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    await asyncContexts.execution.provide(
      {
        correlationId: "req-event-provided",
        signal: controller.signal,
      },
      () => runtime.emitEvent(event),
    );

    expect(seenCorrelationId).toBe("req-event-provided");
    expect(seenSignal).toBe(controller.signal);
    await runtime.dispose();
  });

  it("record captures the full execution tree across parallel branches", async () => {
    const branchTask = defineTask({
      id: "execution-context-record-branch-task",
      run: async () => "branch",
    });

    const parentTask = defineTask({
      id: "execution-context-record-parent-task",
      dependencies: { branchTask },
      run: async (_input, { branchTask: runBranchTask }) =>
        Promise.all([runBranchTask(), runBranchTask()]),
    });

    const app = defineResource({
      id: "execution-context-record-app",
      register: [branchTask, parentTask],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    const output = await asyncContexts.execution.record(
      { correlationId: "req-record-parallel" },
      () => runtime.runTask(parentTask),
    );

    expect(output.result).toEqual(["branch", "branch"]);
    expect(output.recording?.correlationId).toBe("req-record-parallel");
    expect(output.recording?.roots).toHaveLength(1);
    expect(output.recording?.roots[0]?.frame.kind).toBe("task");
    expect(output.recording?.roots[0]?.children).toHaveLength(2);
    expect(
      output.recording?.roots[0]?.children.map((node) => node.frame.kind),
    ).toEqual(["task", "task"]);

    await runtime.dispose();
  });

  it("nested record calls reuse the active recording instead of creating a new one", async () => {
    const nestedSnapshots: string[] = [];

    const task = defineTask({
      id: "execution-context-record-nested-task",
      run: async () => {
        const nested = await asyncContexts.execution.record(async () => {
          nestedSnapshots.push(asyncContexts.execution.use().correlationId);
          return "nested";
        });

        expect(nested.recording?.roots).toHaveLength(1);
        return "done";
      },
    });

    const app = defineResource({
      id: "execution-context-record-nested-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    const output = await asyncContexts.execution.record(
      { correlationId: "req-record-nested" },
      () => runtime.runTask(task),
    );

    expect(output.result).toBe("done");
    expect(nestedSnapshots).toEqual(["req-record-nested"]);
    expect(output.recording?.roots).toHaveLength(1);

    await runtime.dispose();
  });

  it("record seeds the ambient signal for the recorded execution", async () => {
    const controller = new AbortController();

    const task = defineTask({
      id: "execution-context-record-signal-task",
      run: async (_input, _deps, context) => context?.signal,
    });

    const app = defineResource({
      id: "execution-context-record-signal-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    const output = await asyncContexts.execution.record(
      {
        correlationId: "req-record-signal",
        signal: controller.signal,
      },
      () => runtime.runTask(task),
    );

    expect(output.result).toBe(controller.signal);
    expect(output.recording?.correlationId).toBe("req-record-signal");
    await runtime.dispose();
  });

  it("record preserves failed nodes in the execution tree", async () => {
    const task = defineTask({
      id: "execution-context-record-failing-task",
      run: async () => {
        throw new Error("boom");
      },
    });

    const app = defineResource({
      id: "execution-context-record-failing-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app, { executionContext: true });
    await expect(
      asyncContexts.execution.record(
        { correlationId: "req-record-failed" },
        () => runtime.runTask(task),
      ),
    ).rejects.toThrow("boom");

    await runtime.dispose();
  });

  it("keeps disabled runtimes isolated from parent execution contexts", async () => {
    const childTask = defineTask({
      id: "execution-context-child-task",
      run: async () => asyncContexts.execution.tryUse(),
    });

    const parentTask = defineTask({
      id: "execution-context-parent-task",
      run: async () => {
        expect(asyncContexts.execution.use().correlationId).toEqual(
          expect.any(String),
        );
        return childRuntime.runTask(childTask);
      },
    });

    const childApp = defineResource({
      id: "execution-context-child-app",
      register: [childTask],
      init: async () => "child",
    });

    const parentApp = defineResource({
      id: "execution-context-parent-app",
      register: [parentTask],
      init: async () => "parent",
    });

    const childRuntime = await run(childApp);
    const parentRuntime = await run(parentApp, { executionContext: true });

    await expect(parentRuntime.runTask(parentTask)).resolves.toBeUndefined();

    await Promise.all([parentRuntime.dispose(), childRuntime.dispose()]);
  });
});
