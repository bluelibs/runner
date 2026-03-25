import { performance } from "node:perf_hooks";

import {
  runParallelApprovalScenario,
  runParallelMixedReviewScenario,
} from "./index.js";
import { runParallelStressScenario } from "./stress.js";

interface BenchmarkResult {
  count: number;
  elapsedMs: number;
  workflowsPerSecond: number;
}

async function benchmarkScenario(params: {
  count: number;
  label: string;
  run: (count: number) => Promise<unknown>;
}): Promise<BenchmarkResult> {
  const startedAt = performance.now();
  await params.run(params.count);
  const elapsedMs = performance.now() - startedAt;

  return {
    count: params.count,
    elapsedMs,
    workflowsPerSecond: (params.count / elapsedMs) * 1_000,
  };
}

function formatResult(label: string, result: BenchmarkResult): string {
  return [
    label.padEnd(16),
    `count=${String(result.count).padStart(4)}`,
    `time=${result.elapsedMs.toFixed(2).padStart(8)}ms`,
    `throughput=${result.workflowsPerSecond.toFixed(2).padStart(8)} wf/s`,
  ].join("  ");
}

async function runBenchmarks() {
  const driver = (process.env.AGENT_ORCH_DRIVER ?? "memory") as
    | "memory"
    | "redis";
  const counts = [10, 100, 1_000];
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const rabbitUrl = process.env.RABBITMQ_URL ?? "amqp://localhost";

  console.log("Agent orchestration benchmark");
  console.log(`Driver: ${driver}`);
  console.log("Workload: waitForSignal + signal delivery + wait()/cancel/rollback");
  console.log("");

  if (driver === "memory") {
    for (const count of counts) {
      const approval = await benchmarkScenario({
        count,
        label: "parallel-approval",
        run: (batchSize) =>
          runParallelApprovalScenario({
            count: batchSize,
            reviewTimeoutMs: 5_000,
            waitTimeoutMs: 10_000,
          }),
      });

      console.log(formatResult("approval", approval));
    }

    console.log("");

    for (const count of counts) {
      const mixed = await benchmarkScenario({
        count,
        label: "parallel-mixed",
        run: (batchSize) =>
          runParallelMixedReviewScenario({
            count: batchSize,
            reviewTimeoutMs: 5_000,
            revisionTimeoutMs: 5_000,
            waitTimeoutMs: 10_000,
          }),
      });

      console.log(formatResult("mixed-review", mixed));
    }

    console.log("");
  }

  for (const count of counts) {
    const stress = await benchmarkScenario({
      count,
      label: "parallel-stress",
      run: (batchSize) =>
        runParallelStressScenario({
          count: batchSize,
          driver,
          redisUrl,
          rabbitUrl,
          reviewTimeoutMs: 5_000,
          revisionTimeoutMs: 5_000,
          waitTimeoutMs: 10_000,
        }),
    });

    console.log(formatResult("stress-mixed", stress));
  }
}

runBenchmarks().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
