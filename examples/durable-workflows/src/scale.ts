/**
 * Scale Section — many workflow types, many executions, cursor-paged dashboard.
 *
 * Builds lightweight single-step workflows (no signals, no sleeps) so a large
 * fleet completes quickly, then the dashboard pages through every execution
 * state with keyset cursors.
 */
import { r } from "@bluelibs/runner";
import type { DurableResource } from "@bluelibs/runner/node";
import { durable } from "./ids.js";

export const SCALE_WORKFLOW_TYPES = 50;
export const SCALE_EXECUTIONS_PER_TYPE = 20;

export interface ScaleFleet {
  tasks: Array<ReturnType<typeof buildScaleTask>>;
  executionIds: string[];
}

export function buildScaleTask(index: number) {
  const id = `scaleWorkflow${String(index).padStart(2, "0")}`;
  return r
    .task(id)
    .dependencies({ durable })
    .run(async (input: { seq: number }, { durable }) => {
      const durableContext = durable.use();
      return await durableContext.step("echo", async () => ({
        workflow: id,
        seq: input.seq,
      }));
    })
    .build();
}

/** Builds every scale workflow task. Register the result in the app. */
export function buildScaleTasks(): ScaleFleet["tasks"] {
  const tasks: ScaleFleet["tasks"] = [];
  for (let index = 0; index < SCALE_WORKFLOW_TYPES; index += 1) {
    tasks.push(buildScaleTask(index));
  }
  return tasks;
}

/**
 * Starts a fleet of executions spread across every scale workflow type and
 * waits for all of them. Returns every execution id.
 */
export async function runScaleFleet(
  durable: DurableResource,
  tasks: ScaleFleet["tasks"],
): Promise<string[]> {
  const service = durable.service;
  const starts: Array<Promise<string>> = [];
  for (const task of tasks) {
    for (let seq = 0; seq < SCALE_EXECUTIONS_PER_TYPE; seq += 1) {
      starts.push(service.start(task, { seq }));
    }
  }
  const executionIds = await Promise.all(starts);
  await Promise.all(
    executionIds.map((executionId) =>
      service.wait(executionId, {
        timeout: 30_000,
        waitPollIntervalMs: 20,
      }),
    ),
  );
  return executionIds;
}
