import { defineTask, defineResource, defineMiddleware } from "../../define";
import { run } from "../../run";

// Benchmarks are environment-sensitive; keep skipped by default.
describe("Task benchmarks - sync vs async", () => {
  const iterations = 500;

  it("compares sync vs async task execution without middleware", async () => {
    const syncTask = defineTask<number, any>({
      id: "bench.syncTask",
      // Intentionally synchronous
      run: ((n: number) => {
        let acc = 0;
        for (let i = 0; i < 200; i++) acc += (n + i) % 7;
        return acc;
      }) as any,
    } as any);

    const asyncTask = defineTask<number, Promise<number>>({
      id: "bench.asyncTask",
      run: async (n: number) => {
        let acc = 0;
        for (let i = 0; i < 200; i++) acc += (n + i) % 7;
        return acc;
      },
    });

    const app = defineResource({
      id: "bench.app",
      register: [syncTask, asyncTask],
      dependencies: { syncTask, asyncTask },
      async init(_, { syncTask, asyncTask }) {
        // Warm-up
        await asyncTask(0);
        await syncTask(0 as any);

        const syncStart = performance.now();
        for (let i = 0; i < iterations; i++) {
          // Note: sync path still awaited at the TaskRunner boundary
          await syncTask(i as any);
        }
        const syncTime = performance.now() - syncStart;

        const asyncStart = performance.now();
        for (let i = 0; i < iterations; i++) {
          await asyncTask(i);
        }
        const asyncTime = performance.now() - asyncStart;

        // Log metrics for manual inspection
        // eslint-disable-next-line no-console
        console.log(
          `Task benchmark (iterations=${iterations}) -> sync: ${syncTime.toFixed(
            2
          )}ms, async: ${asyncTime.toFixed(2)}ms`
        );
      },
    });

    const { dispose } = await run(app);
    await dispose();
  });

  it("compares with a chain of pass-through middlewares", async () => {
    const chainLength = 10;

    const middlewares = Array.from({ length: chainLength }, (_, idx) =>
      defineMiddleware({
        id: `mw.${idx}`,
        // Return the result of next() directly; no extra async wrapper here
        run: ({ next }: any) => next(),
      })
    );

    const syncTask = defineTask<number, any>({
      id: "bench.syncTask.withMw",
      middleware: middlewares,
      // Intentionally synchronous
      run: ((n: number) => {
        let acc = 0;
        for (let i = 0; i < 200; i++) acc += (n + i) % 7;
        return acc;
      }) as any,
    } as any);

    const asyncTask = defineTask<number, Promise<number>>({
      id: "bench.asyncTask.withMw",
      middleware: middlewares,
      run: async (n: number) => {
        let acc = 0;
        for (let i = 0; i < 200; i++) acc += (n + i) % 7;
        return acc;
      },
    });

    const app = defineResource({
      id: "bench.app.mw",
      register: [...middlewares, syncTask, asyncTask],
      dependencies: { syncTask, asyncTask },
      async init(_, { syncTask, asyncTask }) {
        // Warm-up
        await asyncTask(0);
        await syncTask(0 as any);

        const iters = 5000;
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < iters; i++) {
          await syncTask(i as any);
        }
        const t1 = process.hrtime.bigint();
        const syncNs = Number(t1 - t0);

        const t2 = process.hrtime.bigint();
        for (let i = 0; i < iters; i++) {
          await asyncTask(i);
        }
        const t3 = process.hrtime.bigint();
        const asyncNs = Number(t3 - t2);

        // eslint-disable-next-line no-console
        console.log(
          `Task benchmark with ${chainLength} middlewares (iterations=${iters}) -> sync: ${(
            syncNs / 1e6
          ).toFixed(2)}ms, async: ${(asyncNs / 1e6).toFixed(2)}ms`
        );
      },
    });

    const { dispose } = await run(app);
    await dispose();
  });
});
