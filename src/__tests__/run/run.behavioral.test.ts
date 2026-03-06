import { defineResource } from "../../define";
import { r } from "../../public";
import { run } from "../../run";
import { ResourceLifecycleMode } from "../../types/runner";
import { createMessageError } from "../../errors";

describe("run behavioral scenarios", () => {
  const waitFor = async (
    condition: () => boolean,
    timeoutMs = 100,
    intervalMs = 5,
  ) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (condition()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return condition();
  };

  it("should ensure parallel run() isolation", async () => {
    // We'll use a resource that increments a counter in a shared object
    // to see if they bleed.
    const shared = { counter: 0 };

    const isolatedResource = (id: string) =>
      defineResource({
        id: `isolated-${id}`,
        async init() {
          shared.counter++;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return id;
        },
      });

    const [run1, run2] = await Promise.all([
      run(isolatedResource("1")),
      run(isolatedResource("2")),
    ]);

    expect(run1.value).toBe("1");
    expect(run2.value).toBe("2");
    expect(shared.counter).toBe(2);

    await run1.dispose();
    await run2.dispose();
  });

  it("should handle disposal failure cascading", async () => {
    const order: string[] = [];

    const badResource = defineResource({
      id: "bad",
      init: async () => "bad",
      dispose: async () => {
        order.push("bad");
        throw createMessageError("Disposal failed");
      },
    });

    const goodResource = defineResource({
      id: "good",
      init: async () => "good",
      dispose: async () => {
        order.push("good");
      },
    });

    const app = defineResource({
      id: "app",
      register: [badResource, goodResource],
      async init() {},
    });

    const result = await run(app);

    // Even if one fails, others should be attempted.
    // The runner should collect errors and throw them together or just throw the first one?
    // Based on current implementation, it tries all and then throws a combined error if supported or just the first.
    await expect(result.dispose()).rejects.toThrow("Disposal failed");

    expect(order).toContain("bad");
    expect(order).toContain("good");
  });

  it("fails startup when resource.ready throws and rolls back initialized resources", async () => {
    let dependencyDisposed = false;

    const dependency = defineResource({
      id: "ready-failure-rollback-dependency",
      async init() {
        return "dependency";
      },
      async dispose() {
        dependencyDisposed = true;
      },
    });

    const failing = defineResource({
      id: "ready-failure-rollback-failing",
      dependencies: { dependency },
      async init() {
        return "failing";
      },
      async ready() {
        throw createMessageError("ready failed");
      },
    });

    const app = defineResource({
      id: "ready-failure-rollback-app",
      register: [dependency, failing],
      dependencies: { failing },
      async init() {
        return "app";
      },
    });

    await expect(run(app, { shutdownHooks: false })).rejects.toThrow(
      "ready failed",
    );
    expect(dependencyDisposed).toBe(true);
  });

  it("should handle empty dynamic register return values", async () => {
    const app = defineResource({
      id: "app",
      register: () => [], // Empty return
      async init() {
        return "ok";
      },
    });

    const result = await run(app);
    expect(result.value).toBe("ok");
    await result.dispose();
  });

  it("should handle null dynamic register return values", async () => {
    const app = defineResource({
      id: "app",
      register: (() => null) as any, // Null return
      async init() {
        return "ok";
      },
    });

    const result = await run(app);
    expect(result.value).toBe("ok");
    await result.dispose();
  });

  it("defaults to sequential resource initialization", async () => {
    let releaseFirstInit!: () => void;
    const firstInitGate = new Promise<void>((resolve) => {
      releaseFirstInit = resolve;
    });
    let firstStarted = false;
    let secondStarted = false;

    const first = defineResource({
      id: "init-mode-default-sequential-first",
      async init() {
        firstStarted = true;
        await firstInitGate;
        return "first";
      },
    });

    const second = defineResource({
      id: "init-mode-default-sequential-second",
      async init() {
        secondStarted = true;
        return "second";
      },
    });

    const app = defineResource({
      id: "init-mode-default-sequential-app",
      register: [first, second],
      async init() {
        return "ok";
      },
    });

    const runtimePromise = run(app, { shutdownHooks: false });
    const firstHasStarted = await waitFor(() => firstStarted, 100);
    expect(firstHasStarted).toBe(true);
    expect(secondStarted).toBe(false);

    releaseFirstInit();
    const runtime = await runtimePromise;
    await runtime.dispose();
  });

  it("can initialize independent resources in parallel when lifecycleMode is parallel", async () => {
    let releaseParallelInits!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseParallelInits = resolve;
    });
    let firstStarted = false;
    let secondStarted = false;

    const first = defineResource({
      id: "init-mode-parallel-first",
      async init() {
        firstStarted = true;
        await gate;
        return "first";
      },
    });

    const second = defineResource({
      id: "init-mode-parallel-second",
      async init() {
        secondStarted = true;
        await gate;
        return "second";
      },
    });

    const app = defineResource({
      id: "init-mode-parallel-app",
      register: [first, second],
      async init() {
        return "ok";
      },
    });

    const runtimePromise = run(app, {
      lifecycleMode: ResourceLifecycleMode.Parallel,
      shutdownHooks: false,
    });
    const bothStarted = await waitFor(() => firstStarted && secondStarted, 100);
    expect(bothStarted).toBe(true);

    releaseParallelInits();
    const runtime = await runtimePromise;
    await runtime.dispose();
  });

  it("aggregates parallel resource initialization failures when using deprecated initMode alias", async () => {
    expect.assertions(3);

    const first = defineResource({
      id: "init-mode-parallel-fail-first",
      async init() {
        throw createMessageError("first failed");
      },
    });

    const second = defineResource({
      id: "init-mode-parallel-fail-second",
      async init() {
        throw createMessageError("second failed");
      },
    });

    const app = defineResource({
      id: "init-mode-parallel-fail-app",
      register: [first, second],
      async init() {
        return "ok";
      },
    });

    let caught: unknown;
    try {
      await run(app, {
        lifecycleMode: ResourceLifecycleMode.Parallel,
        shutdownHooks: false,
      });
    } catch (error: unknown) {
      caught = error;
    }

    const aggregate = caught as Error & {
      name: string;
      errors: Error[];
    };
    expect(aggregate.name).toBe("AggregateError");
    expect(aggregate.errors).toHaveLength(2);
    expect(
      aggregate.errors.map((error) => Reflect.get(error, "resourceId")),
    ).toEqual(
      expect.arrayContaining([
        "init-mode-parallel-fail-first",
        "init-mode-parallel-fail-second",
      ]),
    );
  });

  it("should isolate AsyncContext between parallel run() calls (50 runtimes)", async () => {
    const RUNTIME_COUNT = 50;

    // Shared async context definition — same object registered in all runtimes
    const requestContext = r
      .asyncContext<{ runtimeId: number }>("test-parallel-ctx")
      .build();

    // Task that captures and returns the context value
    const captureTask = r
      .task<void>("test-parallel-capture")
      .run(async () => {
        const ctx = requestContext.use();
        return ctx.runtimeId;
      })
      .build();

    // Spin up 50 parallel runtimes
    const runtimes = await Promise.all(
      Array.from({ length: RUNTIME_COUNT }, (_, i) =>
        run(
          r
            .resource(`test-parallel-app-${i}`)
            .register([requestContext, captureTask])
            .build(),
          { shutdownHooks: false },
        ),
      ),
    );

    // Execute task in each runtime with its own context value
    const results = await Promise.all(
      runtimes.map((rt, i) =>
        requestContext.provide({ runtimeId: i }, () => rt.runTask(captureTask)),
      ),
    );

    // Verify each runtime saw only its own context value
    for (let i = 0; i < RUNTIME_COUNT; i++) {
      expect(results[i]).toBe(i);
    }

    // Cleanup
    await Promise.all(runtimes.map((rt) => rt.dispose()));
  });
});
