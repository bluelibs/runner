import type {
  DurableSignalRecord,
  DurableSignalWaiter,
  StepResult,
} from "../core/types";
import { serializer, type RedisStoreRuntime } from "./RedisStore.runtime";
import { createRedisSignalState } from "./RedisStore.signalState";

export async function upsertSignalWaiter(
  runtime: RedisStoreRuntime,
  waiter: DurableSignalWaiter,
): Promise<void> {
  const member = `${waiter.sortKey}\n${waiter.stepId}`;
  const script = `
    local existingMember = redis.call("hget", KEYS[3], ARGV[1])
    if existingMember and existingMember ~= ARGV[2] then
      redis.call("zrem", KEYS[1], existingMember)
      redis.call("hdel", KEYS[2], existingMember)
    end
    redis.call("zadd", KEYS[1], 0, ARGV[2])
    redis.call("hset", KEYS[2], ARGV[2], ARGV[3])
    redis.call("hset", KEYS[3], ARGV[1], ARGV[2])
    return "OK"
  `;

  await runtime.redis.eval(
    script,
    3,
    runtime.signalWaiterOrderKey(waiter.executionId, waiter.signalId),
    runtime.signalWaiterPayloadKey(waiter.executionId, waiter.signalId),
    runtime.signalWaiterStepKey(waiter.executionId, waiter.signalId),
    waiter.stepId,
    member,
    serializer.stringify(waiter),
  );
}

export async function peekNextSignalWaiter(
  runtime: RedisStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalWaiter | null> {
  const outcome = await runtime.redis.eval(
    `
      local member = redis.call("zrange", KEYS[1], 0, 0)[1]
      if not member then
        return nil
      end

      return redis.call("hget", KEYS[2], member)
    `,
    2,
    runtime.signalWaiterOrderKey(executionId, signalId),
    runtime.signalWaiterPayloadKey(executionId, signalId),
  );
  runtime.assertEvalResultNotError(outcome);
  const payload = runtime.parseRedisString(outcome);
  return payload ? (serializer.parse(payload) as DurableSignalWaiter) : null;
}

export async function commitSignalDelivery(
  runtime: RedisStoreRuntime,
  params: {
    executionId: string;
    signalId: string;
    stepId: string;
    stepResult: StepResult;
    signalRecord: DurableSignalRecord;
    timerId?: string;
  },
): Promise<boolean> {
  const result = await runtime.redis.eval(
    `
      local stepPayload = redis.call("hget", KEYS[2], ARGV[1])
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
      if step.result.signalId ~= cjson.null and step.result.signalId ~= nil and step.result.signalId ~= ARGV[2] then
        return 0
      end

      local member = redis.call("hget", KEYS[5], ARGV[1])
      if not member then
        return 0
      end

      local currentSignalState = redis.call("get", KEYS[1])
      local okState, state = pcall(cjson.decode, currentSignalState or ARGV[4])
      if not okState then
        return "__error__:Corrupted durable signal state"
      end
      local okRecord, record = pcall(cjson.decode, ARGV[5])
      if not okRecord then
        return "__error__:Invalid durable signal record payload"
      end
      local okCompletedStep, completedStep = pcall(cjson.decode, ARGV[3])
      if not okCompletedStep then
        return "__error__:Invalid signal delivery step result payload"
      end

      table.insert(state.history, record)
      redis.call("set", KEYS[1], cjson.encode(state))
      redis.call("hset", KEYS[2], ARGV[1], cjson.encode(completedStep))
      redis.call("zrem", KEYS[3], member)
      redis.call("hdel", KEYS[4], member)
      redis.call("hdel", KEYS[5], ARGV[1])

      if ARGV[6] ~= "" then
        redis.call("hdel", KEYS[6], ARGV[6])
        redis.call("zrem", KEYS[7], ARGV[6])
      end

      return 1
    `,
    7,
    runtime.signalKey(params.executionId, params.signalId),
    runtime.stepBucketKey(params.executionId),
    runtime.signalWaiterOrderKey(params.executionId, params.signalId),
    runtime.signalWaiterPayloadKey(params.executionId, params.signalId),
    runtime.signalWaiterStepKey(params.executionId, params.signalId),
    runtime.timersKey(),
    runtime.timersScheduleKey(),
    params.stepId,
    params.signalId,
    serializer.stringify(params.stepResult),
    serializer.stringify(
      createRedisSignalState(params.executionId, params.signalId),
    ),
    serializer.stringify(params.signalRecord),
    params.timerId ?? "",
  );
  runtime.assertEvalResultNotError(result);
  return Number(result) === 1;
}

export async function takeNextSignalWaiter(
  runtime: RedisStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalWaiter | null> {
  const outcome = await runtime.redis.eval(
    `
      local member = redis.call("zrange", KEYS[1], 0, 0)[1]
      if not member then
        return nil
      end

      local payload = redis.call("hget", KEYS[2], member)
      redis.call("zrem", KEYS[1], member)
      redis.call("hdel", KEYS[2], member)

      if payload then
        local okPayload, decoded = pcall(cjson.decode, payload)
        if not okPayload then
          return "__error__:Corrupted durable signal waiter payload"
        end
        if decoded and decoded.stepId then
          redis.call("hdel", KEYS[3], decoded.stepId)
        end
      end

      return payload
    `,
    3,
    runtime.signalWaiterOrderKey(executionId, signalId),
    runtime.signalWaiterPayloadKey(executionId, signalId),
    runtime.signalWaiterStepKey(executionId, signalId),
  );
  runtime.assertEvalResultNotError(outcome);
  const payload = runtime.parseRedisString(outcome);
  return payload ? (serializer.parse(payload) as DurableSignalWaiter) : null;
}

export async function deleteSignalWaiter(
  runtime: RedisStoreRuntime,
  executionId: string,
  signalId: string,
  stepId: string,
): Promise<void> {
  await runtime.redis.eval(
    `
      local member = redis.call("hget", KEYS[3], ARGV[1])
      if not member then
        return 0
      end

      redis.call("zrem", KEYS[1], member)
      redis.call("hdel", KEYS[2], member)
      redis.call("hdel", KEYS[3], ARGV[1])
      return 1
    `,
    3,
    runtime.signalWaiterOrderKey(executionId, signalId),
    runtime.signalWaiterPayloadKey(executionId, signalId),
    runtime.signalWaiterStepKey(executionId, signalId),
    stepId,
  );
}
