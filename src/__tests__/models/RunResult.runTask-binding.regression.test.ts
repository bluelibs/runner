import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

describe("RunResult runTask binding regression", () => {
  it("keeps runtime context when runTask is destructured", async () => {
    const increment = defineTask({
      id: "rr.binding.increment",
      run: async (input: number) => input + 1,
    });

    const app = defineResource({
      id: "rr.binding.app",
      register: [increment],
      init: async () => "ready",
    });

    const runtime = await run(app);
    try {
      const { runTask } = runtime;
      await expect(runTask(increment, 41)).resolves.toBe(42);
    } finally {
      await runtime.dispose();
    }
  });
});
