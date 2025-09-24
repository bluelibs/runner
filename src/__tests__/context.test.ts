import { createContext, task, run, resource } from "../index";
import { ContextError } from "../definers/defineAsyncContext";
import { Logger } from "../models/Logger";

describe("Context System", () => {
  const TestContext = createContext<{ id: string }>();

  test("useContext throws when missing", async () => {
    const r = resource({
      id: "test.context.use",
      register: [TestContext],
      init: async () => TestContext.use(),
    });

    await expect(run(r)).rejects.toThrow(ContextError);

    await TestContext.provide({ id: "1" }, async () => {
      const res = await run(r);
      expect(res).toEqual(
        expect.objectContaining({
          value: { id: "1" },
          dispose: expect.any(Function),
          logger: expect.any(Logger),
        }),
      );
    });
  });

  test("require middleware blocks missing context", async () => {
    const t = task({
      id: "task",
      middleware: [TestContext.require()],
      run: async () => "ok",
    });

    const r = resource({
      id: "resource",
      register: [t, TestContext],
      dependencies: { t },
      init: async (_, deps) => deps.t(),
    });
    await expect(run(r)).rejects.toThrow(ContextError);

    await TestContext.provide({ id: "1" }, async () => {
      const res = await run(r);
      expect(res).toEqual(
        expect.objectContaining({
          value: "ok",
          dispose: expect.any(Function),
          logger: expect.any(Logger),
        }),
      );
    });
  });

  test("concurrent provide calls are isolated", async () => {
    // Use fake timers to make ordering deterministic under coverage/CI
    jest.useFakeTimers();

    const results: string[] = [];

    const p1 = TestContext.provide({ id: "user-1" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10)); // small delay
      const context = TestContext.use();
      results.push(context.id);
      return context.id;
    });

    const p2 = TestContext.provide({ id: "user-2" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5)); // smaller delay
      const context = TestContext.use();
      results.push(context.id);
      return context.id;
    });

    // Advance time to trigger the shorter timeout first, then the longer one
    jest.advanceTimersByTime(5);
    // Flush microtasks so the awaited promise continuations run
    await Promise.resolve();
    jest.advanceTimersByTime(5);
    await Promise.resolve();

    const values = await Promise.all([p1, p2]);

    // Each context should maintain its own value
    expect(values).toEqual(["user-1", "user-2"]);
    expect(results).toEqual(["user-2", "user-1"]); // user-2 finishes first due to shorter delay

    jest.useRealTimers();
  });

  test("nested provide calls work correctly", async () => {
    const result = await TestContext.provide({ id: "outer" }, async () => {
      const outer = TestContext.use();

      const inner = await TestContext.provide({ id: "inner" }, async () => {
        return TestContext.use();
      });

      const afterInner = TestContext.use();

      return { outer: outer.id, inner: inner.id, afterInner: afterInner.id };
    });

    // Outer context should be restored after inner provide completes
    expect(result).toEqual({
      outer: "outer",
      inner: "inner",
      afterInner: "outer", // This should be restored!
    });
  });
});
