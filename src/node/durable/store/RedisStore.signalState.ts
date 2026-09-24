import {
  MAX_QUEUED_SIGNALS_PER_KEY,
  MAX_SIGNAL_HISTORY_PER_KEY,
  type DurableQueuedSignalRecord,
  type DurableSignalRecord,
  type DurableSignalState,
  type StepResult,
} from "../core/types";
import { getSignalIdFromStepId } from "../core/signalWaiters";
import {
  durableExecutionInvariantError,
  durableSignalBacklogExceededError,
} from "../../../errors";
import type { RedisStoreRuntime } from "./RedisStore.runtime";
import {
  decodeSignalRecord,
  encodeSignalRecord,
  splitAroundPayloadSlot,
} from "./RedisStore.signalRecordCodec";

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

/**
 * Lua's cjson encodes an emptied list as `{}`, so a drained queue or a state
 * created inside a script reads back as an object; restore the array shape
 * callers rely on when iterating.
 */
function parseSignalState(
  runtime: RedisStoreRuntime,
  payload: string,
): DurableSignalState {
  const state = runtime.serializer.parse(payload) as DurableSignalState;
  const decodeAll = (records: DurableSignalRecord[]) =>
    Array.isArray(records)
      ? records.map((record) => decodeSignalRecord(runtime, record))
      : [];
  return {
    ...state,
    queued: decodeAll(state.queued),
    history: decodeAll(state.history),
  };
}

function parseSignalRecord(
  runtime: RedisStoreRuntime,
  outcome: unknown,
): DurableSignalRecord | null {
  runtime.assertEvalResultNotError(outcome);
  const payload = runtime.parseRedisString(outcome);
  return payload
    ? decodeSignalRecord(runtime, runtime.serializer.parse(payload))
    : null;
}

export async function getSignalState(
  runtime: RedisStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalState | null> {
  const data = runtime.parseRedisString(
    await runtime.redis.get(runtime.signalKey(executionId, signalId)),
  );
  return data ? parseSignalState(runtime, data) : null;
}

export async function listSignalStates(
  runtime: RedisStoreRuntime,
  executionId: string,
): Promise<DurableSignalState[]> {
  const signalIds = await runtime.scanSetMembers(
    runtime.signalIdsKey(executionId),
  );
  if (signalIds.length === 0) return [];

  const pipeline = runtime.redis.pipeline();
  signalIds.forEach((signalId) =>
    pipeline.get(runtime.signalKey(executionId, signalId)),
  );
  const results = await pipeline.exec();
  if (!results) return [];

  return results
    .map((entry) => runtime.parseRedisString(entry?.[1]))
    .filter((payload): payload is string => payload !== null)
    .map((payload) => parseSignalState(runtime, payload))
    .sort((left, right) => left.signalId.localeCompare(right.signalId));
}

async function mutateSignalState(params: {
  runtime: RedisStoreRuntime;
  executionId: string;
  signalId: string;
  record: DurableSignalRecord | DurableQueuedSignalRecord;
  mutateHistory: boolean;
  mutateQueue: boolean;
}): Promise<void> {
  const script = `
    local current = redis.call("get", KEYS[1])
    local okState, state = pcall(cjson.decode, current or ARGV[1])
    if not okState then
      return "__error__:Corrupted durable signal state"
    end
    local okRecord, record = pcall(cjson.decode, ARGV[2])
    if not okRecord then
      return "__error__:Invalid durable signal record payload"
    end
    ${
      params.mutateQueue
        ? `if #state.queued >= ${MAX_QUEUED_SIGNALS_PER_KEY} then return "__backlog_full__" end`
        : ""
    }
    ${params.mutateHistory ? "table.insert(state.history, record)" : ""}
    ${
      params.mutateHistory
        ? `while #state.history > ${MAX_SIGNAL_HISTORY_PER_KEY} do table.remove(state.history, 1) end`
        : ""
    }
    ${params.mutateQueue ? "table.insert(state.queued, record)" : ""}
    redis.call("set", KEYS[1], cjson.encode(state))
    redis.call("sadd", KEYS[2], ARGV[3])
    return "OK"
  `;

  const outcome = await params.runtime.redis.eval(
    script,
    2,
    params.runtime.signalKey(params.executionId, params.signalId),
    params.runtime.signalIdsKey(params.executionId),
    params.runtime.serializer.stringify(
      createRedisSignalState(params.executionId, params.signalId),
    ),
    encodeSignalRecord(params.runtime, params.record),
    params.signalId,
  );
  if (outcome === "__backlog_full__") {
    return durableSignalBacklogExceededError.throw({
      executionId: params.executionId,
      signalId: params.signalId,
      limit: MAX_QUEUED_SIGNALS_PER_KEY,
    });
  }
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

  return parseSignalRecord(
    runtime,
    await runtime.redis.eval(
      script,
      1,
      runtime.signalKey(executionId, signalId),
    ),
  );
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
    -- Legacy records hold a decoded payload; newer ones keep it serialized.
    local payload = record.encodedPayload or cjson.encode(record.payload)
    redis.call("hset", KEYS[2], ARGV[1], ARGV[2] .. payload .. ARGV[3])
    return cjson.encode(record)
  `;

  return parseSignalRecord(
    runtime,
    await runtime.redis.eval(
      script,
      2,
      runtime.signalKey(stepResult.executionId, signalId),
      runtime.stepBucketKey(stepResult.executionId),
      stepResult.stepId,
      ...splitAroundPayloadSlot(runtime, stepResult),
    ),
  );
}
