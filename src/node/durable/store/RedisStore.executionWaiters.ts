import type { DurableExecutionWaiter, StepResult } from "../core/types";
import { serializer, type RedisStoreRuntime } from "./RedisStore.runtime";

function waiterField(executionId: string, stepId: string): string {
  return `${executionId}:${stepId}`;
}

export async function upsertExecutionWaiter(
  runtime: RedisStoreRuntime,
  waiter: DurableExecutionWaiter,
): Promise<void> {
  await runtime.redis.hset(
    runtime.executionWaiterKey(waiter.targetExecutionId),
    waiterField(waiter.executionId, waiter.stepId),
    serializer.stringify(waiter),
  );
}

export async function listExecutionWaiters(
  runtime: RedisStoreRuntime,
  targetExecutionId: string,
): Promise<DurableExecutionWaiter[]> {
  const data = await runtime.redis.hgetall(
    runtime.executionWaiterKey(targetExecutionId),
  );
  return runtime.parseHashValues<DurableExecutionWaiter>(data);
}

export async function commitExecutionWaiterCompletion(
  runtime: RedisStoreRuntime,
  params: {
    targetExecutionId: string;
    executionId: string;
    stepId: string;
    stepResult: StepResult;
    timerId?: string;
  },
): Promise<boolean> {
  const result = await runtime.redis.eval(
    `
      local waiterField = ARGV[1]
      local waiterPayload = redis.call("hget", KEYS[1], waiterField)
      if not waiterPayload then
        return 0
      end

      local stepPayload = redis.call("hget", KEYS[2], ARGV[2])
      if not stepPayload then
        return 0
      end

      local okStep, step = pcall(cjson.decode, stepPayload)
      if not okStep or type(step) ~= "table" or type(step.result) ~= "table" then
        return 0
      end
      if step.result.state ~= "waiting" then
        return 0
      end
      if step.result.targetExecutionId ~= ARGV[3] then
        return 0
      end

      local okCompletedStep, completedStep = pcall(cjson.decode, ARGV[4])
      if not okCompletedStep then
        return "__error__:Invalid execution waiter completion payload"
      end

      redis.call("hset", KEYS[2], ARGV[2], cjson.encode(completedStep))
      redis.call("hdel", KEYS[1], waiterField)

      if ARGV[5] ~= "" then
        redis.call("hdel", KEYS[3], ARGV[5])
        redis.call("zrem", KEYS[4], ARGV[5])
      end

      return 1
    `,
    4,
    runtime.executionWaiterKey(params.targetExecutionId),
    runtime.stepBucketKey(params.executionId),
    runtime.timersKey(),
    runtime.timersScheduleKey(),
    waiterField(params.executionId, params.stepId),
    params.stepId,
    params.targetExecutionId,
    serializer.stringify(params.stepResult),
    params.timerId ?? "",
  );
  runtime.assertEvalResultNotError(result);
  return Number(result) === 1;
}

export async function deleteExecutionWaiter(
  runtime: RedisStoreRuntime,
  targetExecutionId: string,
  executionId: string,
  stepId: string,
): Promise<void> {
  await runtime.redis.hdel(
    runtime.executionWaiterKey(targetExecutionId),
    waiterField(executionId, stepId),
  );
}
