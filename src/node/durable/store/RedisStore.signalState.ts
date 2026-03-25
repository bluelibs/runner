import {
  type DurableQueuedSignalRecord,
  type DurableSignalRecord,
  type DurableSignalState,
  type StepResult,
} from "../core/types";
import { getSignalIdFromStepId } from "../core/signalWaiters";
import { durableExecutionInvariantError } from "../../../errors";
import type { RedisStoreRuntime } from "./RedisStore.runtime";

export const createRedisSignalState = (
  executionId: string,
  signalId: string,
): DurableSignalState => ({
  executionId,
  signalId,
  queued: [],
  history: [],
});

function getSignalIdFromStepResult(result: StepResult): string {
  const state = result.result;
  if (
    typeof state === "object" &&
    state !== null &&
    "signalId" in state &&
    typeof state.signalId === "string"
  ) {
    return state.signalId;
  }

  const signalId = getSignalIdFromStepId(result.stepId);
  if (signalId) {
    return signalId;
  }

  return durableExecutionInvariantError.throw({
    message: `Unable to resolve signal id for buffered step '${result.stepId}' on execution '${result.executionId}'.`,
  });
}

export async function getSignalState(
  runtime: RedisStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalState | null> {
  const data = runtime.parseRedisString(
    await runtime.redis.get(runtime.signalKey(executionId, signalId)),
  );
  return data ? (runtime.serializer.parse(data) as DurableSignalState) : null;
}

async function mutateSignalState(params: {
  runtime: RedisStoreRuntime;
  executionId: string;
  signalId: string;
  record: DurableSignalRecord | DurableQueuedSignalRecord;
  mutateHistory: boolean;
  mutateQueue: boolean;
  invalidPayloadMessage: string;
}): Promise<void> {
  const script = `
    local current = redis.call("get", KEYS[1])
    local okState, state = pcall(cjson.decode, current or ARGV[1])
    if not okState then
      return "__error__:Corrupted durable signal state"
    end
    local okRecord, record = pcall(cjson.decode, ARGV[2])
    if not okRecord then
      return "__error__:${params.invalidPayloadMessage}"
    end
    ${params.mutateHistory ? "table.insert(state.history, record)" : ""}
    ${params.mutateQueue ? "table.insert(state.queued, record)" : ""}
    redis.call("set", KEYS[1], cjson.encode(state))
    return "OK"
  `;

  const outcome = await params.runtime.redis.eval(
    script,
    1,
    params.runtime.signalKey(params.executionId, params.signalId),
    params.runtime.serializer.stringify(
      createRedisSignalState(params.executionId, params.signalId),
    ),
    params.runtime.serializer.stringify(params.record),
  );
  params.runtime.assertEvalResultNotError(outcome);
}

export async function appendSignalRecord(
  runtime: RedisStoreRuntime,
  executionId: string,
  signalId: string,
  record: DurableSignalRecord,
): Promise<void> {
  await mutateSignalState({
    runtime,
    executionId,
    signalId,
    record,
    mutateHistory: true,
    mutateQueue: false,
    invalidPayloadMessage: "Invalid durable signal record payload",
  });
}

export async function bufferSignalRecord(
  runtime: RedisStoreRuntime,
  executionId: string,
  signalId: string,
  record: DurableQueuedSignalRecord,
): Promise<void> {
  await mutateSignalState({
    runtime,
    executionId,
    signalId,
    record,
    mutateHistory: true,
    mutateQueue: true,
    invalidPayloadMessage: "Invalid durable queued signal payload",
  });
}

export async function enqueueQueuedSignalRecord(
  runtime: RedisStoreRuntime,
  executionId: string,
  signalId: string,
  record: DurableQueuedSignalRecord,
): Promise<void> {
  await mutateSignalState({
    runtime,
    executionId,
    signalId,
    record,
    mutateHistory: false,
    mutateQueue: true,
    invalidPayloadMessage: "Invalid durable queued signal payload",
  });
}

export async function consumeQueuedSignalRecord(
  runtime: RedisStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalRecord | null> {
  const script = `
    local current = redis.call("get", KEYS[1])
    if not current then
      return nil
    end

    local okState, state = pcall(cjson.decode, current)
    if not okState then
      return "__error__:Corrupted durable signal state"
    end
    local record = table.remove(state.queued, 1)
    redis.call("set", KEYS[1], cjson.encode(state))

    if not record then
      return nil
    end

    return cjson.encode(record)
  `;

  const outcome = await runtime.redis.eval(
    script,
    1,
    runtime.signalKey(executionId, signalId),
  );
  runtime.assertEvalResultNotError(outcome);
  const payload = runtime.parseRedisString(outcome);
  return payload
    ? (runtime.serializer.parse(payload) as DurableSignalRecord)
    : null;
}

export async function consumeBufferedSignalForStep(
  runtime: RedisStoreRuntime,
  stepResult: StepResult,
): Promise<DurableSignalRecord | null> {
  const signalId = getSignalIdFromStepResult(stepResult);
  const script = `
    local current = redis.call("get", KEYS[1])
    if not current then
      return nil
    end

    local okState, state = pcall(cjson.decode, current)
    if not okState then
      return "__error__:Corrupted durable signal state"
    end
    local record = table.remove(state.queued, 1)
    if not record then
      return nil
    end

    redis.call("set", KEYS[1], cjson.encode(state))
    local okStepResult, stepResult = pcall(cjson.decode, ARGV[2])
    if not okStepResult or type(stepResult) ~= "table" then
      return "__error__:Invalid buffered signal step result payload"
    end
    if type(stepResult.result) ~= "table" then
      return "__error__:Invalid buffered signal completion state"
    end

    stepResult.result.payload = record.payload
    redis.call("hset", KEYS[2], ARGV[1], cjson.encode(stepResult))
    return cjson.encode(record)
  `;

  const outcome = await runtime.redis.eval(
    script,
    2,
    runtime.signalKey(stepResult.executionId, signalId),
    runtime.stepBucketKey(stepResult.executionId),
    stepResult.stepId,
    runtime.serializer.stringify(stepResult),
  );
  runtime.assertEvalResultNotError(outcome);
  const payload = runtime.parseRedisString(outcome);
  return payload
    ? (runtime.serializer.parse(payload) as DurableSignalRecord)
    : null;
}
