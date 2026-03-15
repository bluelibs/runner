import {
  defineEvent,
  defineHook,
  defineResource,
  defineTask,
} from "../../define";
import { run } from "../../run";
import { resources } from "../../index";

function createTaskEventHookTaskLoopFixture() {
  const calls: string[] = [];
  const event = defineEvent<{ count: number }>({ id: "trace-loop-event" });

  const taskA = defineTask({
    id: "trace-loop-task-a",
    dependencies: { eventManager: resources.eventManager },
    run: async (input: { count: number }, { eventManager }) => {
      calls.push(`taskA:${input.count}`);

      if (input.count < 2) {
        await eventManager.emit(event, input, {
          kind: "task",
          id: "trace-loop-task-a",
        });
      }

      return input.count;
    },
  });

  const taskB = defineTask({
    id: "trace-loop-task-b",
    dependencies: { taskA },
    run: async (input: { count: number }, { taskA: runTaskA }) => {
      calls.push(`taskB:${input.count}`);
      return runTaskA(input);
    },
  });

  const hook = defineHook({
    id: "trace-loop-hook",
    dependencies: { taskB },
    on: event,
    run: async (emission, { taskB: runTaskB }) => {
      calls.push(`hook:${emission.data.count}`);
      await runTaskB({ count: emission.data.count + 1 });
    },
  });

  const app = defineResource({
    id: "trace-loop-app",
    register: [event, hook, taskA, taskB],
    init: async () => "ok",
  });

  return { app, calls, taskA };
}

describe("Execution Trace (integration)", () => {
  describe("event cycle detection", () => {
    it("detects A -> B -> A event cycle with executionContext enabled", async () => {
      const e1 = defineEvent<{ v: number }>({ id: "trace-e1" });
      const e2 = defineEvent<{ v: number }>({ id: "trace-e2" });

      const onE1 = defineHook({
        id: "trace-onE1",
        dependencies: { eventManager: resources.eventManager },
        on: e1,
        run: async (ev, { eventManager }) => {
          await eventManager.emit(
            e2,
            { v: ev.data.v + 1 },
            { kind: "hook", id: "trace-onE1" },
          );
        },
      });

      const onE2 = defineHook({
        id: "trace-onE2",
        dependencies: { eventManager: resources.eventManager },
        on: e2,
        run: async (ev, { eventManager }) => {
          await eventManager.emit(
            e1,
            { v: ev.data.v + 1 },
            { kind: "hook", id: "trace-onE2" },
          );
        },
      });

      const app = defineResource({
        id: "trace-app",
        register: [e1, e2, onE1, onE2],
        init: async () => "ok",
      });

      const rr = await run(app, { executionContext: true });
      await expect(rr.emitEvent(e1, { v: 1 })).rejects.toThrow(
        /cycle detected/i,
      );
      await rr.dispose();
    });

    it("does not detect cycles when executionContext is disabled", async () => {
      let callCount = 0;
      const event = defineEvent<void>({ id: "trace-no-detect" });

      const hook = defineHook({
        id: "trace-no-detect-hook",
        on: event,
        run: async () => {
          callCount++;
        },
      });

      const app = defineResource({
        id: "trace-no-detect-app",
        register: [event, hook],
        init: async () => "ok",
      });

      // Without executionContext, no cycle detection — just runs
      const rr = await run(app);
      await rr.emitEvent(event, undefined);
      expect(callCount).toBeGreaterThanOrEqual(1);
      await rr.dispose();
    });
  });

  describe("task -> event -> hook chain", () => {
    it("allows legitimate task -> event -> hook chains under threshold", async () => {
      const event = defineEvent<string>({ id: "trace-chain-event" });

      const hook = defineHook({
        id: "trace-chain-hook",
        on: event,
        run: async () => {
          // Just processes the event, no re-emission
        },
      });

      const task = defineTask({
        id: "trace-chain-task",
        dependencies: { eventManager: resources.eventManager },
        run: async (input: string, { eventManager }) => {
          await eventManager.emit(event, input, {
            kind: "task",
            id: "trace-chain-task",
          });
          return `processed: ${input}`;
        },
      });

      const app = defineResource({
        id: "trace-chain-app",
        register: [event, hook, task],
        init: async () => "ok",
      });

      const rr = await run(app, { executionContext: true });
      const result = await rr.runTask(task, "hello");
      expect(result).toBe("processed: hello");
      await rr.dispose();
    });

    it("allows a bounded task -> event -> hook -> task loop when executionContext is disabled", async () => {
      const { app, calls, taskA } = createTaskEventHookTaskLoopFixture();

      const rr = await run(app);
      await expect(rr.runTask(taskA, { count: 0 })).resolves.toBe(0);
      expect(calls).toEqual([
        "taskA:0",
        "hook:0",
        "taskB:1",
        "taskA:1",
        "hook:1",
        "taskB:2",
        "taskA:2",
      ]);
      await rr.dispose();
    });

    it("detects a task -> event -> hook -> task loop when executionContext is enabled", async () => {
      const { app, taskA } = createTaskEventHookTaskLoopFixture();

      const rr = await run(app, { executionContext: true });
      await expect(rr.runTask(taskA, { count: 0 })).rejects.toThrow(
        /cycle detected/i,
      );
      await rr.dispose();
    });
  });

  describe("custom thresholds", () => {
    it("respects custom maxRepetitions", async () => {
      const e1 = defineEvent<void>({ id: "custom-thresh-e1" });
      const e2 = defineEvent<void>({ id: "custom-thresh-e2" });

      // Two hooks that bounce events between each other (A→B→A cycle)
      const onE1 = defineHook({
        id: "custom-thresh-onE1",
        dependencies: { eventManager: resources.eventManager },
        on: e1,
        run: async (_ev, { eventManager }) => {
          await eventManager.emit(e2, undefined, {
            kind: "hook",
            id: "custom-thresh-onE1",
          });
        },
      });

      const onE2 = defineHook({
        id: "custom-thresh-onE2",
        dependencies: { eventManager: resources.eventManager },
        on: e2,
        run: async (_ev, { eventManager }) => {
          await eventManager.emit(e1, undefined, {
            kind: "hook",
            id: "custom-thresh-onE2",
          });
        },
      });

      const app = defineResource({
        id: "custom-thresh-app",
        register: [e1, e2, onE1, onE2],
        init: async () => "ok",
      });

      const rr = await run(app, {
        executionContext: { cycleDetection: { maxRepetitions: 5 } },
      });
      await expect(rr.emitEvent(e1, undefined)).rejects.toThrow(
        /cycle detected/i,
      );
      await rr.dispose();
    });
  });
});
