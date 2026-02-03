import { defineResource, defineTask, defineTaskMiddleware } from "../../define";
import { run } from "../../run";

describe("Task middleware chaining", () => {
  test("middleware can pass undefined to next()", async () => {
    const middleware = defineTaskMiddleware({
      id: "tests.middleware.nextUndefined",
      run: async ({ next }) => {
        return next(undefined as any);
      },
    });

    const task = defineTask<string | undefined, Promise<string | undefined>>({
      id: "tests.task.nextUndefined",
      middleware: [middleware],
      run: async (input) => input,
    });

    const app = defineResource({
      id: "tests.app.nextUndefined",
      register: [middleware, task],
    });

    const rt = await run(app);
    const result = await rt.runTask(task, "initial");
    expect(result).toBeUndefined();
    await rt.dispose();
  });
});
