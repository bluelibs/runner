import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

describe("Per-task interceptors inside resources", () => {
  it("tracks the resource id that registers a local task interceptor", async () => {
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
        return { adder: deps.adder };
      },
    });

    const appHarness = defineResource({
      id: "tests.interceptors.harness",
      register: [installer],
    });
    const rr = await run(appHarness);
    const installerValue = rr.getResourceValue(installer);
    expect(installerValue.adder.getInterceptingResourceIds()).toEqual([
      installer.id,
    ]);

    const result = await rr.runTask(adder, { value: 10 });
    expect(result).toEqual({ value: 21 }); // (10 * 2) + 1

    await rr.dispose();
  });

  it("returns unique intercepting resource ids in registration order", async () => {
    const adder = defineTask({
      id: "tests.tasks.adder.multiple",
      run: async (input: { value: number }) => {
        return { value: input.value + 1 } as const;
      },
    });

    const firstInstaller = defineResource({
      id: "tests.resources.installer.first",
      register: [adder],
      dependencies: { adder },
      async init(_, deps) {
        deps.adder.intercept(async (next, input) => {
          return next({ value: input.value * 2 });
        });
        return { adder: deps.adder };
      },
    });

    const secondInstaller = defineResource({
      id: "tests.resources.installer.second",
      dependencies: { adder, firstInstaller },
      async init(_, deps) {
        deps.adder.intercept(async (next, input) => {
          return next({ value: input.value + 3 });
        });
        return {};
      },
    });

    const appHarness = defineResource({
      id: "tests.interceptors.harness.multiple",
      register: [firstInstaller, secondInstaller],
    });

    const rr = await run(appHarness);
    const firstInstallerValue = rr.getResourceValue(firstInstaller);
    expect(firstInstallerValue.adder.getInterceptingResourceIds()).toEqual([
      firstInstaller.id,
      secondInstaller.id,
    ]);

    const result = await rr.runTask(adder, { value: 10 });
    expect(result).toEqual({ value: 24 }); // ((10 * 2) + 3) + 1

    await rr.dispose();
  });
});
