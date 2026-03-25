import type { Execution, StepResult } from "../core/types";
import type { ListExecutionsOptions } from "../core/interfaces/store";
import {
  createDurableAuditEntryId,
  type DurableAuditEntry,
} from "../core/audit";
import type { RedisStoreRuntime } from "./RedisStore.runtime";

async function loadExecutionsFromSet(
  runtime: RedisStoreRuntime,
  setKey: string,
): Promise<Execution[]> {
  const executionIds = await runtime.scanSetMembers(setKey);
  if (executionIds.length === 0) return [];

  const pipeline = runtime.redis.pipeline();
  executionIds.forEach((id) => pipeline.get(runtime.executionKey(id)));
  const results = await pipeline.exec();
  if (!results) return [];

  return results
    .map((entry) => entry?.[1])
    .filter((payload): payload is string => typeof payload === "string")
    .map((payload) => runtime.serializer.parse(payload) as Execution);
}

export async function listExecutions(
  runtime: RedisStoreRuntime,
  options: ListExecutionsOptions,
): Promise<Execution[]> {
  let executions = await loadExecutionsFromSet(
    runtime,
    runtime.allExecutionsKey(),
  );
  if (options.status && options.status.length > 0) {
    executions = executions.filter((execution) =>
      options.status?.includes(execution.status),
    );
  }
  if (options.workflowKey) {
    executions = executions.filter(
      (execution) => execution.workflowKey === options.workflowKey,
    );
  }
  executions.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 100;
  return executions.slice(offset, offset + limit);
}

export async function listStepResults(
  runtime: RedisStoreRuntime,
  executionId: string,
): Promise<StepResult[]> {
  return runtime
    .parseHashValues<StepResult>(
      await runtime.redis.hgetall(runtime.stepBucketKey(executionId)),
    )
    .sort(
      (a, b) =>
        new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
    );
}

export async function appendAuditEntry(
  runtime: RedisStoreRuntime,
  entry: DurableAuditEntry,
): Promise<void> {
  const id = entry.id || createDurableAuditEntryId(entry.at.getTime());
  await runtime.redis.hset(
    runtime.auditBucketKey(entry.executionId),
    id,
    runtime.serializer.stringify({ ...entry, id }),
  );
}

export async function listAuditEntries(
  runtime: RedisStoreRuntime,
  executionId: string,
  options: { limit?: number; offset?: number },
): Promise<DurableAuditEntry[]> {
  const entries = runtime.parseHashValues<DurableAuditEntry>(
    await runtime.redis.hgetall(runtime.auditBucketKey(executionId)),
  );
  entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  const offset = options.offset ?? 0;
  const limit = options.limit ?? entries.length;
  return entries.slice(offset, offset + limit);
}

export async function getStepResult(
  runtime: RedisStoreRuntime,
  executionId: string,
  stepId: string,
): Promise<StepResult | null> {
  const data = runtime.parseRedisString(
    await runtime.redis.hget(runtime.stepBucketKey(executionId), stepId),
  );
  return data ? (runtime.serializer.parse(data) as StepResult) : null;
}

export async function saveStepResult(
  runtime: RedisStoreRuntime,
  result: StepResult,
): Promise<void> {
  await runtime.redis.hset(
    runtime.stepBucketKey(result.executionId),
    result.stepId,
    runtime.serializer.stringify(result),
  );
}
