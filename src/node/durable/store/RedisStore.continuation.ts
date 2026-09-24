import {
  ExecutionStatus,
  MAX_QUEUED_SIGNALS_PER_KEY,
  type Execution,
} from "../core/types";
import {
  durableExecutionInvariantError,
  durableSignalBacklogExceededError,
} from "../../../errors";
import type { RedisStoreRuntime } from "./RedisStore.runtime";
import {
  executionIndexArgs,
  writeExecutionIndexScript,
} from "./RedisStore.executionIndex";
import { statusFlags } from "./RedisStore.executionState";

const SIGNAL_SET_CHANGED = "__signal_set_changed__";
const BACKLOG_FULL_PREFIX = "__backlog_full__:";
// A retry only happens when a brand-new signal key appears on the prior run
// between the scan and the script, so a handful of attempts is plenty.
const MAX_COMMIT_ATTEMPTS = 5;
const FIXED_KEY_COUNT = 9;

/**
 * Lua: closes the prior run, creates the successor, and hands every queued
 * signal backlog of the prior run to the successor in one atomic step, so a
 * signal buffered before the commit can never be stranded on a closed run.
 *
 * Signal keys are passed in (KEYS[10..]) from a pre-scan of the prior run's
 * signal-id set; the set only ever grows, so an unchanged cardinality proves
 * the scan is still complete and every write below touches declared keys.
 */
const createContinuedExecutionScript = `
  local current = redis.call("get", KEYS[1])
  if not current then
    return 0
  end

  local okCurrent, currentExecution = pcall(cjson.decode, current)
  if not okCurrent then
    return "__error__:Corrupted durable execution payload"
  end

  if currentExecution.status ~= ARGV[13] then
    return 0
  end

  local signalCount = tonumber(ARGV[14])
  if redis.call("scard", KEYS[8]) ~= signalCount then
    return "${SIGNAL_SET_CHANGED}"
  end

  local moves = {}
  for index = 1, signalCount do
    local signalId = ARGV[14 + index]
    local priorKey = KEYS[${FIXED_KEY_COUNT} + index * 2 - 1]
    local successorKey = KEYS[${FIXED_KEY_COUNT} + index * 2]
    local priorRaw = redis.call("get", priorKey)
    if priorRaw then
      local okPrior, priorState = pcall(cjson.decode, priorRaw)
      if not okPrior then
        return "__error__:Corrupted durable signal state"
      end
      if #priorState.queued > 0 then
        local successorState = {
          executionId = ARGV[6],
          signalId = signalId,
          queued = {},
          history = {}
        }
        local successorRaw = redis.call("get", successorKey)
        if successorRaw then
          local okSuccessor, decoded = pcall(cjson.decode, successorRaw)
          if not okSuccessor then
            return "__error__:Corrupted durable signal state"
          end
          successorState = decoded
        end
        if #successorState.queued + #priorState.queued > ${MAX_QUEUED_SIGNALS_PER_KEY} then
          return "${BACKLOG_FULL_PREFIX}" .. signalId
        end
        table.insert(moves, {
          signalId = signalId,
          priorKey = priorKey,
          priorState = priorState,
          successorKey = successorKey,
          successorState = successorState
        })
      end
    end
  end

  redis.call("set", KEYS[1], ARGV[1])
  redis.call("sadd", KEYS[3], ARGV[2])
  if ARGV[3] == "1" then
    redis.call("sadd", KEYS[4], ARGV[2])
  else
    redis.call("srem", KEYS[4], ARGV[2])
  end
  if ARGV[4] == "1" then
    redis.call("sadd", KEYS[5], ARGV[2])
  else
    redis.call("srem", KEYS[5], ARGV[2])
  end
  ${writeExecutionIndexScript("KEYS[6]", "KEYS[7]", {
    idArg: "ARGV[2]",
    indexArg: "ARGV[9]",
    stateArg: "ARGV[10]",
  })}

  redis.call("set", KEYS[2], ARGV[5])
  redis.call("sadd", KEYS[3], ARGV[6])
  if ARGV[7] == "1" then
    redis.call("sadd", KEYS[4], ARGV[6])
  else
    redis.call("srem", KEYS[4], ARGV[6])
  end
  if ARGV[8] == "1" then
    redis.call("sadd", KEYS[5], ARGV[6])
  else
    redis.call("srem", KEYS[5], ARGV[6])
  end
  ${writeExecutionIndexScript("KEYS[6]", "KEYS[7]", {
    idArg: "ARGV[6]",
    indexArg: "ARGV[11]",
    stateArg: "ARGV[12]",
  })}

  for _, move in ipairs(moves) do
    for _, record in ipairs(move.priorState.queued) do
      table.insert(move.successorState.queued, record)
    end
    move.priorState.queued = {}
    redis.call("set", move.priorKey, cjson.encode(move.priorState))
    redis.call("set", move.successorKey, cjson.encode(move.successorState))
    redis.call("sadd", KEYS[9], move.signalId)
  end
  return 1
`;

async function evalCreateContinuedExecution(
  runtime: RedisStoreRuntime,
  params: { priorExecution: Execution; successorExecution: Execution },
  signalIds: string[],
): Promise<unknown> {
  const prior = params.priorExecution;
  const successor = params.successorExecution;
  const priorFlags = statusFlags(prior.status);
  const successorFlags = statusFlags(successor.status);
  const signalKeys = signalIds.flatMap((signalId) => [
    runtime.signalKey(prior.id, signalId),
    runtime.signalKey(successor.id, signalId),
  ]);

  return await runtime.redis.eval(
    createContinuedExecutionScript,
    FIXED_KEY_COUNT + signalKeys.length,
    runtime.executionKey(prior.id),
    runtime.executionKey(successor.id),
    runtime.allExecutionsKey(),
    runtime.activeExecutionsKey(),
    runtime.stuckExecutionsKey(),
    runtime.k("execution_index_metadata"),
    runtime.k("execution_index_states"),
    runtime.signalIdsKey(prior.id),
    runtime.signalIdsKey(successor.id),
    ...signalKeys,
    runtime.serializer.stringify(prior),
    prior.id,
    priorFlags.isActive,
    priorFlags.isStuck,
    runtime.serializer.stringify(successor),
    successor.id,
    successorFlags.isActive,
    successorFlags.isStuck,
    ...executionIndexArgs(runtime, prior),
    ...executionIndexArgs(runtime, successor),
    ExecutionStatus.Running,
    String(signalIds.length),
    ...signalIds,
  );
}

export async function createContinuedExecution(
  runtime: RedisStoreRuntime,
  params: {
    priorExecution: Execution;
    successorExecution: Execution;
  },
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
    const signalIds = await runtime.scanSetMembers(
      runtime.signalIdsKey(params.priorExecution.id),
    );
    const outcome = await evalCreateContinuedExecution(
      runtime,
      params,
      signalIds,
    );
    if (outcome === SIGNAL_SET_CHANGED) continue;
    if (
      typeof outcome === "string" &&
      outcome.startsWith(BACKLOG_FULL_PREFIX)
    ) {
      return durableSignalBacklogExceededError.throw({
        executionId: params.successorExecution.id,
        signalId: outcome.slice(BACKLOG_FULL_PREFIX.length),
        limit: MAX_QUEUED_SIGNALS_PER_KEY,
      });
    }
    runtime.assertEvalResultNotError(outcome);
    return outcome === 1;
  }

  return durableExecutionInvariantError.throw({
    message: `Continue-as-new of execution '${params.priorExecution.id}' kept racing new signal keys after ${MAX_COMMIT_ATTEMPTS} attempts.`,
  });
}
