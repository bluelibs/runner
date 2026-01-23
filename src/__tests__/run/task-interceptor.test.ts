import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

describe("Per-task interceptors inside resources", () => {
  it("allows a resource to register an interceptor via deps.task.intercept before system is ready", async () => {
    const adder = defineTask({
      id: "tests.tasks.adder",
      run: async (input: { value: number }) => {
        return { value: input.value + 1 } as const;
      },
    });

    const installer = defineResource({
      id: "tests.resources.installer",
      register: [adder],
      dependencies: { adder },
      async init(_, deps) {
        deps.adder.intercept(async (next, input) => {
          // mutate input before task run
          const modified = { value: input.value * 2 };
          return next(modified);
        });
        return {};
      },
    });

    const appHarness = defineResource({
      id: "tests.interceptors.harness",
      register: [installer],
    });
    const rr = await run(appHarness);

    const result = await rr.runTask(adder, { value: 10 });
    expect(result).toEqual({ value: 21 }); // (10 * 2) + 1

    await rr.dispose();
  });
});
