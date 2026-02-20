import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { fallbackTaskMiddleware } from "../../../globals/middleware/fallback.middleware";
import { createMessageError } from "../../../errors";

describe("Fallback Middleware", () => {
  it("should return fallback value when task fails", async () => {
    const task = defineTask({
      id: "fallback.value",
      middleware: [fallbackTaskMiddleware.with({ fallback: "fallback-value" })],
      run: async () => {
        throw createMessageError("Original error");
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        return await task();
      },
    });

    const result = await run(app);
    expect(result.value).toBe("fallback-value");
    await result.dispose();
  });

  it("should return original result when task succeeds", async () => {
    const task = defineTask({
      id: "fallback.success",
      middleware: [fallbackTaskMiddleware.with({ fallback: "fallback-value" })],
      run: async () => {
        return "success";
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        return await task();
      },
    });

    const result = await run(app);
    expect(result.value).toBe("success");
    await result.dispose();
  });

  it("should execute fallback function when task fails", async () => {
    const task = defineTask({
      id: "fallback.function",
      middleware: [
        fallbackTaskMiddleware.with({
          fallback: (err: Error, input: string) =>
            `fixed:${err.message}:${input}`,
        }),
      ],
      run: async (_input: string) => {
        throw createMessageError("fail");
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        return await task("input");
      },
    });

    const result = await run(app);
    expect(result.value).toBe("fixed:fail:input");
    await result.dispose();
  });

  it("should execute fallback task when task fails", async () => {
    const planB = defineTask({
      id: "planB",
      run: async (input: string) => `planB:${input}`,
    });

    const task = defineTask({
      id: "fallback.task",
      middleware: [fallbackTaskMiddleware.with({ fallback: planB })],
      run: async (_input: string) => {
        throw createMessageError("fail");
      },
    });

    const app = defineResource({
      id: "app",
      register: [task, planB],
      dependencies: { task },
      async init(_, { task }) {
        return await task("input");
      },
    });

    const result = await run(app);
    expect(result.value).toBe("planB:input");
    await result.dispose();
  });
});
