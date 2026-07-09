import { defineResource, defineTask } from "../../define";
import { run } from "../../run";

export type ParallelRuntimeLifecycleResult = {
  runtimeCount: number;
  totalTimeMs: number;
  avgTimePerRuntimeMs: number;
  runtimesPerSecond: number;
};

export async function benchmarkParallelRuntimeLifecycle(
  runtimeCount: number,
): Promise<ParallelRuntimeLifecycleResult> {
  const app = defineResource({ id: "benchmark-parallel-runtime-app" });
  const startedAt = performance.now();
  const runtimes = await Promise.all(
    Array.from({ length: runtimeCount }, () =>
      run(app, { logs: { printThreshold: null } }),
    ),
  );
  await Promise.all(runtimes.map((runtime) => runtime.dispose()));
  const totalTimeMs = performance.now() - startedAt;

  return {
    runtimeCount,
    totalTimeMs,
    avgTimePerRuntimeMs: totalTimeMs / runtimeCount,
    runtimesPerSecond: runtimeCount / (totalTimeMs / 1000),
  };
}

export type ExecutionContextOverheadResult = {
  iterations: number;
  withoutContextMs: number;
  withContextMs: number;
  overheadFactor: number;
};

async function measureTaskExecutions(
  iterations: number,
  executionContext: boolean,
): Promise<number> {
  const task = defineTask({
    id: "benchmark-execution-context-task",
    run: async (input: number) => input + 1,
  });
  const app = defineResource({
    id: "benchmark-execution-context-app",
    register: [task],
  });
  const runtime = await run(app, {
    executionContext,
    logs: { printThreshold: null },
  });

  for (let index = 0; index < 250; index++) {
    await runtime.runTask(task, index);
  }

  const startedAt = performance.now();
  for (let index = 0; index < iterations; index++) {
    await runtime.runTask(task, index);
  }
  const duration = performance.now() - startedAt;
  await runtime.dispose();

  return duration;
}

export async function benchmarkExecutionContextOverhead(
  iterations: number,
  order: "context-first" | "context-last",
): Promise<ExecutionContextOverheadResult> {
  const firstUsesContext = order === "context-first";
  const firstDuration = await measureTaskExecutions(
    iterations,
    firstUsesContext,
  );
  const secondDuration = await measureTaskExecutions(
    iterations,
    !firstUsesContext,
  );
  const withContextMs = firstUsesContext ? firstDuration : secondDuration;
  const withoutContextMs = firstUsesContext ? secondDuration : firstDuration;

  return {
    iterations,
    withoutContextMs,
    withContextMs,
    overheadFactor: withContextMs / withoutContextMs,
  };
}

export async function benchmarkBalancedExecutionContextOverhead(
  iterations: number,
): Promise<ExecutionContextOverheadResult> {
  const contextFirst = await benchmarkExecutionContextOverhead(
    iterations,
    "context-first",
  );
  const contextLast = await benchmarkExecutionContextOverhead(
    iterations,
    "context-last",
  );
  const withoutContextMs =
    (contextFirst.withoutContextMs + contextLast.withoutContextMs) / 2;
  const withContextMs =
    (contextFirst.withContextMs + contextLast.withContextMs) / 2;

  return {
    iterations: iterations * 2,
    withoutContextMs,
    withContextMs,
    overheadFactor: withContextMs / withoutContextMs,
  };
}
