import { defineResource, defineTask } from "../../define";
import { globalResources } from "../../globals/globalResources";
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

describe("taskRunner.intercept()", () => {
  it("applies globally even when registered from a private resource subtree", async () => {
    const outsideTask = defineTask({
      id: "tests.taskRunnerIntercept.global.outsideTask",
      run: async () => "outside",
    });

    const privateInstaller = defineResource({
      id: "tests.taskRunnerIntercept.global.privateInstaller",
      isolate: { exports: "none" },
      dependencies: { taskRunner: globalResources.taskRunner },
      async init(_, deps) {
        deps.taskRunner.intercept(async (next, input) => {
          const result = await next(input);
          return `intercepted:${result}`;
        });
        return undefined;
      },
    });

    const app = defineResource({
      id: "tests.taskRunnerIntercept.global.app",
      register: [privateInstaller, outsideTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app);
    await expect(runtime.runTask(outsideTask)).resolves.toBe(
      "intercepted:outside",
    );
    await runtime.dispose();
  });

  it("supports optional when() filtering", async () => {
    const matchedTask = defineTask({
      id: "tests.taskRunnerIntercept.when.matchedTask",
      run: async () => "matched",
    });

    const untouchedTask = defineTask({
      id: "tests.taskRunnerIntercept.when.untouchedTask",
      run: async () => "untouched",
    });

    const installer = defineResource({
      id: "tests.taskRunnerIntercept.when.installer",
      dependencies: { taskRunner: globalResources.taskRunner },
      async init(_, deps) {
        deps.taskRunner.intercept(
          async (next, input) => {
            const result = await next(input);
            return `filtered:${result}`;
          },
          {
            when: (taskDefinition) => taskDefinition.id === matchedTask.id,
          },
        );
        return undefined;
      },
    });

    const app = defineResource({
      id: "tests.taskRunnerIntercept.when.app",
      register: [installer, matchedTask, untouchedTask],
      async init() {
        return "ok";
      },
    });

    const runtime = await run(app);
    await expect(runtime.runTask(matchedTask)).resolves.toBe(
      "filtered:matched",
    );
    await expect(runtime.runTask(untouchedTask)).resolves.toBe("untouched");
    await runtime.dispose();
  });
});
