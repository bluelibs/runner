import type { DurableCommandRecord } from "../core/interfaces/commands";
import type { Execution } from "../core/types";
import { isExecutionTerminal } from "../core/types";
import { durableExecutionInvariantError } from "../../../errors";
import type { RedisStoreRuntime } from "./RedisStore.runtime";
import {
  historyKey,
  historySequenceKey,
  recordHistoryScript,
} from "./RedisStore.history";
import { check, Match } from "../../../tools/check";
import { isDeepStrictEqual } from "node:util";

export function commandQueueKey(
  runtime: RedisStoreRuntime,
  id: string,
): string {
  return runtime.k(`command_queue:${runtime.encodeKeyPart(id)}`);
}
function recordsKey(runtime: RedisStoreRuntime) {
  return runtime.k("command_receipts");
}
function statusesKey(runtime: RedisStoreRuntime) {
  return runtime.k("command_statuses");
}

export async function getCommand(
  runtime: RedisStoreRuntime,
  id: string,
): Promise<DurableCommandRecord | null> {
  const raw = runtime.parseRedisString(
    await runtime.redis.hget(recordsKey(runtime), id),
  );
  return raw === null
    ? null
    : runtime.serializer.parse<DurableCommandRecord>(raw);
}

export async function getNextCommand(
  runtime: RedisStoreRuntime,
  id: string,
): Promise<DurableCommandRecord | null> {
  const raw = await runtime.redis.eval(
    `
    local id = redis.call("lindex", KEYS[1], 0)
    if not id then return nil end
    return redis.call("hget", KEYS[2], id)
  `,
    2,
    commandQueueKey(runtime, id),
    recordsKey(runtime),
  );
  return raw === null
    ? null
    : runtime.serializer.parse<DurableCommandRecord>(
        runtime.parseRedisString(raw)!,
      );
}

export async function enqueueCommand(
  runtime: RedisStoreRuntime,
  command: DurableCommandRecord,
): Promise<DurableCommandRecord> {
  const payload = runtime.serializer.stringify(command);
  for (let attempt = 0; attempt < 20; attempt++) {
    const existing = await getCommand(runtime, command.id);
    if (existing) return existing;
    const source = runtime.parseRedisString(
      await runtime.redis.get(runtime.executionKey(command.executionId)),
    );
    const execution =
      source === null ? null : runtime.serializer.parse<Execution>(source);
    if (
      !execution ||
      isExecutionTerminal(execution.status) ||
      execution.status === "cancelling" ||
      execution.workflowVersion !== command.workflowVersion
    )
      return durableExecutionInvariantError.throw({
        message:
          "Commands require a live execution with the accepted workflow version.",
      });
    const result = await runtime.redis.eval(
      `
      local existing = redis.call("hget", KEYS[1], ARGV[1])
      if existing then return existing end
      if redis.call("get", KEYS[4]) ~= ARGV[3] then return nil end
      redis.call("hset", KEYS[1], ARGV[1], ARGV[2])
      redis.call("hset", KEYS[2], ARGV[1], "pending")
      redis.call("rpush", KEYS[3], ARGV[1])
      return ARGV[2]
    `,
      4,
      recordsKey(runtime),
      statusesKey(runtime),
      commandQueueKey(runtime, command.executionId),
      runtime.executionKey(command.executionId),
      command.id,
      payload,
      source,
    );
    if (typeof result === "string")
      return runtime.serializer.parse<DurableCommandRecord>(result);
  }
  return durableExecutionInvariantError.throw({
    message: "Command admission could not obtain a stable execution snapshot.",
  });
}

export async function saveCommand(
  runtime: RedisStoreRuntime,
  command: DurableCommandRecord,
): Promise<boolean> {
  check(command.status, Match.OneOf("pending", "running"));
  const result = await runtime.redis.eval(
    `
    local status = redis.call("hget", KEYS[2], ARGV[1])
    if (status ~= "pending" and status ~= "running") or redis.call("lindex", KEYS[3], 0) ~= ARGV[1] then return 0 end
    redis.call("hset", KEYS[1], ARGV[1], ARGV[2])
    redis.call("hset", KEYS[2], ARGV[1], ARGV[3])
    return 1
  `,
    3,
    recordsKey(runtime),
    statusesKey(runtime),
    commandQueueKey(runtime, command.executionId),
    command.id,
    runtime.serializer.stringify(command),
    command.status,
  );
  return result === 1;
}

export async function completeCommand(
  runtime: RedisStoreRuntime,
  command: DurableCommandRecord,
  expected?: Execution,
): Promise<boolean> {
  check(command.status, Match.OneOf("completed", "failed"));
  const success = command.status === "completed";
  if (
    success &&
    (!expected ||
      isExecutionTerminal(expected.status) ||
      expected.status === "paused" ||
      expected.status === "cancelling")
  )
    return false;
  let expectedPayload = "";
  if (success) {
    const raw = runtime.parseRedisString(
      await runtime.redis.get(runtime.executionKey(command.executionId)),
    );
    if (
      raw === null ||
      !isDeepStrictEqual(runtime.serializer.parse<Execution>(raw), expected)
    )
      return false;
    expectedPayload = raw;
  }
  const state = command.state
    ? runtime.serializer.stringify({
        executionId: command.executionId,
        state: command.state.value,
        updatedAt: command.completedAt,
      })
    : "";
  const history =
    expected?.historyRecorded && success && command.stateInitialized
      ? JSON.stringify({
          kind: "command",
          stepId: `__command:${command.id}`,
          phase: "completed",
          statePayload: command.state
            ? runtime.serializer.stringify(command.state)
            : null,
        })
      : "";
  const result = await runtime.redis.eval(
    `
    local status = redis.call("hget", KEYS[2], ARGV[1])
    if (status ~= "pending" and status ~= "running") or redis.call("lindex", KEYS[3], 0) ~= ARGV[1] then return 0 end
    if ARGV[3] == "completed" and redis.call("get", KEYS[4]) ~= ARGV[4] then return 0 end
    if ARGV[3] == "completed" and ARGV[5] == "1" then
      if ARGV[6] == "" then redis.call("del", KEYS[5]) else redis.call("set", KEYS[5], ARGV[6]) end
    end
    redis.call("hset", KEYS[1], ARGV[1], ARGV[2])
    redis.call("hset", KEYS[2], ARGV[1], ARGV[3])
    redis.call("lpop", KEYS[3])
    if ARGV[7] ~= "" then
      local KEYS = {KEYS[6], KEYS[7]}
      local ARGV = {ARGV[7]}
      ${recordHistoryScript}
    end
    return 1
  `,
    7,
    recordsKey(runtime),
    statusesKey(runtime),
    commandQueueKey(runtime, command.executionId),
    runtime.executionKey(command.executionId),
    runtime.workflowStateKey(command.executionId),
    historyKey(runtime, command.executionId),
    historySequenceKey(runtime, command.executionId),
    command.id,
    runtime.serializer.stringify({ ...command, state: undefined }),
    command.status,
    expectedPayload,
    command.stateInitialized ? "1" : "0",
    state,
    history,
  );
  return result === 1;
}
