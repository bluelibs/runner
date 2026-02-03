import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { debounceTaskMiddleware } from "../../../globals/middleware/temporal.middleware";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe("Temporal Middleware: Debounce", () => {
  it("should debounce task executions", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "debounce.task",
      middleware: [debounceTaskMiddleware.with({ ms: 50 })],
      run: async (val: string) => {
        callCount++;
        return val;
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        const results = await Promise.all([task("a"), task("b"), task("c")]);
        return results;
      },
    });

    const results = (await run(app)).value;

    expect(callCount).toBe(1);
    expect(results).toEqual(["c", "c", "c"]);
  });

  it("should handle multiple debounce cycles", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "debounce.cycles",
      middleware: [debounceTaskMiddleware.with({ ms: 50 })],
      run: async (val: string) => {
        callCount++;
        return val;
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        const r1 = await Promise.all([task("a"), task("b")]);
        await sleep(100);
        const r2 = await Promise.all([task("c"), task("d")]);
        return [...r1, ...r2];
      },
    });

    const results = (await run(app)).value;

    expect(callCount).toBe(2);
    expect(results).toEqual(["b", "b", "d", "d"]);
  });

  it("should handle errors in debounced task", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "debounce.error",
      middleware: [debounceTaskMiddleware.with({ ms: 50 })],
      run: async () => {
        callCount++;
        throw new Error("Debounce error");
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await Promise.all([
          task().catch((e) => e.message),
          task().catch((e) => e.message),
        ]);
      },
    });

    await run(app);
    expect(callCount).toBe(1);
  });
});
