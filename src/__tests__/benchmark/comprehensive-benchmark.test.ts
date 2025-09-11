import {
  defineTask,
  defineResource,
  defineEvent,
  defineHook,
  defineTaskMiddleware,
} from "../../define";
import { run } from "../../run";
import { globals } from "../../index";

describe("Comprehensive Performance Benchmarks", () => {
  let results: Record<string, any> = {};

  // Configuration for benchmark runs
  const BENCHMARK_CONFIG = {
    runs: process.env.CI ? 3 : 5, // Fewer runs in CI due to time constraints
    warmupRuns: 2,
    isCI: !!(process.env.CI || process.env.GITHUB_ACTIONS),
  };

  async function runMultipleTimes<T>(
    fn: () => Promise<T>,
    runs: number,
  ): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < runs; i++) {
      // run sequentially to avoid shared-state/resource conflicts between runs
      // and to produce stable timing measurements
      // eslint-disable-next-line no-await-in-loop
      results.push(await fn());
    }
    return results;
  }

  function calculateStats(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      min: sorted[0],
      max: sorted[len - 1],
      median:
        len % 2 === 0
          ? (sorted[len / 2 - 1] + sorted[len / 2]) / 2
          : sorted[Math.floor(len / 2)],
      mean: values.reduce((a, b) => a + b, 0) / len,
      p25: sorted[Math.floor(len * 0.25)],
      p75: sorted[Math.floor(len * 0.75)],
      values,
    };
  }

  afterAll(() => {
    // Output all benchmark results in a structured format
    console.log("\n=== BlueLibs Runner Performance Benchmark Results ===");
    console.log(JSON.stringify(results, null, 2));
    console.log("=====================================================\n");

    // Optional: write to file if BENCHMARK_OUTPUT is provided (for CI)
    const outputPath = process.env.BENCHMARK_OUTPUT;
    if (outputPath) {
      try {
        const fs = require("fs");
        const os = require("os");
        const meta = {
          timestamp: new Date().toISOString(),
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpu: os.cpus?.()[0]?.model || "unknown",
          isCI: BENCHMARK_CONFIG.isCI,
          runs: BENCHMARK_CONFIG.runs,
          warmupRuns: BENCHMARK_CONFIG.warmupRuns,
        };
        fs.writeFileSync(
          outputPath,
          JSON.stringify({ meta, results }, null, 2),
          "utf8",
        );
        // eslint-disable-next-line no-console
        console.log(`Benchmark results written to ${outputPath}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Failed to write benchmark results:", e);
      }
    }
  });

  it("should benchmark basic task execution", async () => {
    const iterations = 1000;
    const task = defineTask({
      id: "benchmark.basic.task",
      run: async (n: number) => n * 2,
    });

    const runBenchmark = async () => {
      let benchmarkResult: any;

      const app = defineResource({
        id: "benchmark.basic.app",
        register: [task],
        dependencies: { task },
        async init(_, { task }) {},
      });

      const { dispose, runTask } = await run(app);

      // Extended warm-up for more stable results
      for (let w = 0; w < BENCHMARK_CONFIG.warmupRuns * 100; w++) {
        await runTask(task, w);
      }

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        await runTask(task, i);
      }
      const duration = performance.now() - start;

      benchmarkResult = {
        totalTimeMs: parseFloat(duration.toFixed(2)),
        avgTimePerTaskMs: parseFloat((duration / iterations).toFixed(4)),
        tasksPerSecond: Math.round(iterations / (duration / 1000)),
      };

      await dispose();

      return benchmarkResult;
    };

    // Run warmup rounds
    for (let w = 0; w < BENCHMARK_CONFIG.warmupRuns; w++) {
      await runBenchmark();
    }

    // Run actual benchmark multiple times
    const benchmarkResults = await runMultipleTimes(
      runBenchmark,
      BENCHMARK_CONFIG.runs,
    );

    const totalTimes = benchmarkResults.map((r) => r.totalTimeMs);
    const avgTimes = benchmarkResults.map((r) => r.avgTimePerTaskMs);
    const tasksPerSec = benchmarkResults.map((r) => r.tasksPerSecond);

    results.basicTaskExecution = {
      iterations,
      runs: BENCHMARK_CONFIG.runs,
      totalTimeMs: calculateStats(totalTimes),
      avgTimePerTaskMs: calculateStats(avgTimes),
      tasksPerSecond: calculateStats(tasksPerSec),
    };

    console.log(
      `Basic task execution: ${results.basicTaskExecution.tasksPerSecond.median} tasks/sec (median of ${BENCHMARK_CONFIG.runs} runs)`,
    );
  });

  it("should benchmark task execution with middleware", async () => {
    const iterations = 1000;
    const middlewareCount = 5;

    const middlewares = Array.from({ length: middlewareCount }, (_, idx) =>
      defineTaskMiddleware({
        id: `benchmark.middleware.${idx}`,
        run: async ({ next, task }) => {
          // Simple pass-through with minimal overhead
          return next(task?.input);
        },
      }),
    );

    const task = defineTask({
      id: "benchmark.middleware.task",
      middleware: middlewares,
      run: async (n: number) => n * 2,
    });

    const app = defineResource({
      id: "benchmark.middleware.app",
      register: [...middlewares, task],
      dependencies: { task },
      async init(_, { task }) {
        // Warm-up
        await task(1);

        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
          await task(i);
        }
        const duration = performance.now() - start;

        results.middlewareTaskExecution = {
          iterations,
          middlewareCount,
          totalTimeMs: parseFloat(duration.toFixed(2)),
          avgTimePerTaskMs: parseFloat((duration / iterations).toFixed(4)),
          tasksPerSecond: Math.round(iterations / (duration / 1000)),
          middlewareOverheadMs: parseFloat(
            (
              duration / iterations -
              results.basicTaskExecution.avgTimePerTaskMs
            ).toFixed(4),
          ),
        };

        console.log(
          `Task execution with ${middlewareCount} middlewares: ${results.middlewareTaskExecution.tasksPerSecond} tasks/sec`,
        );
      },
    });

    const { dispose } = await run(app);
    await dispose();
  });

  it("should benchmark resource initialization", async () => {
    const resourceCount = 100;
    const resources = Array.from({ length: resourceCount }, (_, idx) =>
      defineResource({
        id: `benchmark.resource.${idx}`,
        init: async () => ({ value: idx, timestamp: Date.now() }),
      }),
    );

    const app = defineResource({
      id: "benchmark.resource.app",
      register: resources,
      dependencies: Object.fromEntries(
        resources.map((r, idx) => [`resource${idx}`, r]),
      ),
      async init() {
        // Resources are initialized during the run() call
        return { initialized: true };
      },
    });

    const start = performance.now();
    const { dispose } = await run(app);
    const duration = performance.now() - start;
    await dispose();

    results.resourceInitialization = {
      resourceCount,
      totalTimeMs: parseFloat(duration.toFixed(2)),
      avgTimePerResourceMs: parseFloat((duration / resourceCount).toFixed(4)),
      resourcesPerSecond: Math.round(resourceCount / (duration / 1000)),
    };

    console.log(
      `Resource initialization: ${results.resourceInitialization.resourcesPerSecond} resources/sec`,
    );
  });

  it("should benchmark event emission and handling", async () => {
    const iterations = 500;
    let eventHandlerCallCount = 0;

    const testEvent = defineEvent<{ value: number }>({
      id: "benchmark.event",
    });

    const eventHandler = defineHook({
      id: "benchmark.event.handler",
      on: testEvent,
      run: async ({ data }) => {
        eventHandlerCallCount++;
        return data.value * 2;
      },
    });

    const emitterTask = defineTask({
      id: "benchmark.event.emitter",
      dependencies: { testEvent },
      run: async (value: number, { testEvent }) => {
        await testEvent({ value });
        return value;
      },
    });

    const app = defineResource({
      id: "benchmark.event.app",
      register: [testEvent, eventHandler, emitterTask],
      dependencies: { emitterTask },
      async init(_, { emitterTask }) {
        // Warm-up
        await emitterTask(1);
        eventHandlerCallCount = 0; // Reset after warm-up

        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
          await emitterTask(i);
        }
        const duration = performance.now() - start;

        results.eventEmissionAndHandling = {
          iterations,
          totalTimeMs: parseFloat(duration.toFixed(2)),
          avgTimePerEventMs: parseFloat((duration / iterations).toFixed(4)),
          eventsPerSecond: Math.round(iterations / (duration / 1000)),
          eventHandlerCallCount,
        };

        console.log(
          `Event emission: ${results.eventEmissionAndHandling.eventsPerSecond} events/sec`,
        );
      },
    });

    const { dispose } = await run(app);
    await dispose();
    expect(eventHandlerCallCount).toBe(iterations);
  });

  it("should benchmark dependency resolution with complex chains", async () => {
    const chainDepth = 10;

    // Create a chain of dependencies
    const deps: any[] = [];
    for (let idx = 0; idx < chainDepth; idx++) {
      if (idx === 0) {
        deps.push(
          defineResource({
            id: `benchmark.dep.${idx}`,
            init: async () => ({ level: idx, value: `base-${idx}` }),
          }),
        );
      } else {
        deps.push(
          defineResource({
            id: `benchmark.dep.${idx}`,
            dependencies: { prev: deps[idx - 1] },
            init: async (_, { prev }) => ({
              level: idx,
              value: `${prev.value}-${idx}`,
            }),
          }),
        );
      }
    }

    const finalResource = defineResource({
      id: "benchmark.dep.final",
      dependencies: { finalDep: deps[chainDepth - 1] },
      init: async (_, { finalDep }) => finalDep,
    });

    const iterations = 100;
    const apps = Array.from({ length: iterations }, (_, idx) =>
      defineResource({
        id: `benchmark.dep.app.${idx}`,
        register: [...deps, finalResource],
        dependencies: { finalResource },
        init: async (_, { finalResource }) => finalResource,
      }),
    );

    const start = performance.now();
    for (const app of apps) {
      const { dispose } = await run(app);
      await dispose();
    }
    const duration = performance.now() - start;

    results.dependencyResolution = {
      iterations,
      chainDepth,
      totalTimeMs: parseFloat(duration.toFixed(2)),
      avgTimePerChainMs: parseFloat((duration / iterations).toFixed(4)),
      chainsPerSecond: Math.round(iterations / (duration / 1000)),
    };

    console.log(
      `Dependency resolution: ${results.dependencyResolution.chainsPerSecond} chains/sec`,
    );
  });

  it("should benchmark built-in cache middleware performance", async () => {
    const iterations = 200;
    const cacheHitIterations = 100;

    const expensiveTask = defineTask({
      id: "benchmark.cache.expensive",
      middleware: [globals.middleware.task.cache.with({ ttl: 5000 })],
      run: async (n: number) => {
        // Simulate expensive computation
        let result = 0;
        for (let i = 0; i < 1000; i++) {
          result += (n + i) % 7;
        }
        return result;
      },
    });

    const app = defineResource({
      id: "benchmark.cache.app",
      register: [
        expensiveTask,
        globals.middleware.task.cache,
        globals.resources.cache,
      ],
      dependencies: { expensiveTask },
      async init(_, { expensiveTask }) {
        // Benchmark without cache (first calls)
        const start1 = performance.now();
        for (let i = 0; i < iterations; i++) {
          await expensiveTask(i);
        }
        const withoutCacheDuration = performance.now() - start1;

        // Benchmark with cache hits (repeated calls)
        const start2 = performance.now();
        for (let i = 0; i < cacheHitIterations; i++) {
          await expensiveTask(i % 10); // Reuse same 10 values to ensure cache hits
        }
        const withCacheDuration = performance.now() - start2;

        results.cacheMiddleware = {
          iterationsWithoutCache: iterations,
          iterationsWithCache: cacheHitIterations,
          timeWithoutCacheMs: parseFloat(withoutCacheDuration.toFixed(2)),
          timeWithCacheMs: parseFloat(withCacheDuration.toFixed(2)),
          avgTimeWithoutCacheMs: parseFloat(
            (withoutCacheDuration / iterations).toFixed(4),
          ),
          avgTimeWithCacheMs: parseFloat(
            (withCacheDuration / cacheHitIterations).toFixed(4),
          ),
          speedupFactor: parseFloat(
            (
              withoutCacheDuration /
              iterations /
              (withCacheDuration / cacheHitIterations)
            ).toFixed(2),
          ),
        };

        console.log(
          `Cache middleware speedup: ${results.cacheMiddleware.speedupFactor}x faster with cache hits`,
        );
      },
    });

    const { dispose } = await run(app);
    await dispose();
  });

  it("should benchmark memory usage patterns", async () => {
    const measureMemory = () => {
      if (global.gc) {
        global.gc();
      }
      return process.memoryUsage();
    };

    const beforeMemory = measureMemory();

    // Create a large number of resources and tasks
    const resourceCount = 50;
    const taskCount = 50;

    const resources = Array.from({ length: resourceCount }, (_, idx) =>
      defineResource({
        id: `memory.resource.${idx}`,
        init: async () => ({
          data: new Array(1000).fill(idx),
          timestamp: Date.now(),
        }),
      }),
    );

    const tasks = Array.from({ length: taskCount }, (_, idx) =>
      defineTask({
        id: `memory.task.${idx}`,
        dependencies: { resource: resources[idx % resourceCount] },
        run: async (input: number, { resource }) => {
          return resource.data.reduce((sum, val) => sum + val + input, 0);
        },
      }),
    );

    const app = defineResource({
      id: "memory.app",
      register: [...resources, ...tasks],
      dependencies: Object.fromEntries([
        ...resources.map((r, idx) => [`resource${idx}`, r]),
        ...tasks.map((t, idx) => [`task${idx}`, t]),
      ]),
      async init(config, deps) {
        const afterInitMemory = measureMemory();

        // Execute some tasks
        const iterations = 10;
        const taskKeys = Object.keys(deps).filter((k) => k.startsWith("task"));
        for (let i = 0; i < iterations; i++) {
          for (const taskKey of taskKeys.slice(0, 10)) {
            // Use first 10 tasks
            await (deps as any)[taskKey](i);
          }
        }

        const afterExecutionMemory = measureMemory();

        results.memoryUsage = {
          before: {
            heapUsedMB: parseFloat(
              (beforeMemory.heapUsed / 1024 / 1024).toFixed(2),
            ),
            heapTotalMB: parseFloat(
              (beforeMemory.heapTotal / 1024 / 1024).toFixed(2),
            ),
          },
          afterInit: {
            heapUsedMB: parseFloat(
              (afterInitMemory.heapUsed / 1024 / 1024).toFixed(2),
            ),
            heapTotalMB: parseFloat(
              (afterInitMemory.heapTotal / 1024 / 1024).toFixed(2),
            ),
          },
          afterExecution: {
            heapUsedMB: parseFloat(
              (afterExecutionMemory.heapUsed / 1024 / 1024).toFixed(2),
            ),
            heapTotalMB: parseFloat(
              (afterExecutionMemory.heapTotal / 1024 / 1024).toFixed(2),
            ),
          },
          initOverheadMB: parseFloat(
            (
              (afterInitMemory.heapUsed - beforeMemory.heapUsed) /
              1024 /
              1024
            ).toFixed(2),
          ),
          executionOverheadMB: parseFloat(
            (
              (afterExecutionMemory.heapUsed - afterInitMemory.heapUsed) /
              1024 /
              1024
            ).toFixed(2),
          ),
          componentCount: resourceCount + taskCount,
        };

        console.log(
          `Memory overhead: ${results.memoryUsage.initOverheadMB}MB for ${results.memoryUsage.componentCount} components`,
        );
      },
    });

    const { dispose } = await run(app);
    await dispose();
  });
});
