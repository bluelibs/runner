import { check, Match } from "../../../tools/check";
import { durableExecutionInvariantError } from "../../../errors";
import type { ListExecutionsOptions } from "../core/interfaces/store";
import type { DurableExecutionState, Execution } from "../core/types";
import {
  executionIndexMember,
  executionIndexPartitions,
  executionQueryAfter,
  executionQueryPartitions,
  executionQueryLimit,
  toDurableExecutionState,
} from "../core/executionIndex";
import type { RedisStoreRuntime } from "./RedisStore.runtime";

/** Appended to the execution's atomic write; metadata does not depend on serializer wire shape. */
export function writeExecutionIndexScript(
  metadataKey: string,
  statesKey: string,
  positions: { idArg?: string; indexArg?: string; stateArg?: string } = {},
): string {
  const idArg = positions.idArg ?? "ARGV[2]";
  const indexArg = positions.indexArg ?? "ARGV[6]";
  const stateArg = positions.stateArg ?? "ARGV[7]";
  return `
    local nextIndex = cjson.decode(${indexArg})
    local previous = redis.call("hget", ${metadataKey}, ${idArg})
    if previous ~= ${indexArg} then
      if previous then
        local oldIndex = cjson.decode(previous)
        for _, partition in ipairs(oldIndex.partitions) do
          redis.call("zrem", partition, oldIndex.member)
        end
        redis.call("hdel", ${statesKey}, oldIndex.member)
      end
      for _, partition in ipairs(nextIndex.partitions) do
        redis.call("zadd", partition, 0, nextIndex.member)
      end
      redis.call("hset", ${metadataKey}, ${idArg}, ${indexArg})
    end
    redis.call("hset", ${statesKey}, nextIndex.member, ${stateArg})
  `;
}

/** Serializer-independent index identities plus the payload-free serialized state. */
export function executionIndexArgs(
  runtime: RedisStoreRuntime,
  execution: Execution,
): string[] {
  return [
    JSON.stringify({
      member: executionIndexMember(execution),
      partitions: executionIndexPartitions(execution).map((partition) =>
        runtime.k(`execution_index:${partition}`),
      ),
    }),
    runtime.serializer.stringify(toDurableExecutionState(execution)),
  ];
}

export async function getExecutionState(
  runtime: RedisStoreRuntime,
  id: string,
): Promise<DurableExecutionState | null> {
  const result = await runtime.redis.eval(
    `
    local metadata = redis.call("hget", KEYS[1], ARGV[1])
    if not metadata then
      if redis.call("exists", KEYS[3]) == 1 then return "__error__:Execution index needs backfill" end
      return nil
    end
    local state = redis.call("hget", KEYS[2], cjson.decode(metadata).member)
    if not state then return "__error__:Missing indexed execution state" end
    return state
  `,
    3,
    runtime.k("execution_index_metadata"),
    runtime.k("execution_index_states"),
    runtime.executionKey(id),
    id,
  );
  runtime.assertEvalResultNotError(result);
  return result === null
    ? null
    : (runtime.serializer.parse(
        check(result, String),
      ) as DurableExecutionState);
}

export async function listExecutionStates(
  runtime: RedisStoreRuntime,
  options: ListExecutionsOptions,
): Promise<DurableExecutionState[]> {
  const limit = executionQueryLimit(options);
  const partitions = executionQueryPartitions(options).map((partition) =>
    runtime.k(`execution_index:${partition}`),
  );
  const after = executionQueryAfter(options);
  const result = await runtime.redis.eval(
    `
    if redis.call("scard", KEYS[1]) ~= redis.call("hlen", KEYS[2]) then
      return "__error__:Execution index needs backfill. Run rebuildExecutionIndex before indexed listing."
    end
    local members = {}
    for index = 4, #KEYS do
      local page = redis.call("zrangebylex", KEYS[index], ARGV[1], "+", "LIMIT", 0, ARGV[2])
      for _, member in ipairs(page) do table.insert(members, member) end
    end
    table.sort(members)
    local states = {}
    for index = 1, math.min(#members, tonumber(ARGV[2])) do
      local state = redis.call("hget", KEYS[3], members[index])
      if not state then return "__error__:Missing indexed execution state" end
      table.insert(states, state)
    end
    return states
  `,
    3 + partitions.length,
    runtime.allExecutionsKey(),
    runtime.k("execution_index_metadata"),
    runtime.k("execution_index_states"),
    ...partitions,
    after ? `(${after}` : "-",
    limit,
  );
  runtime.assertEvalResultNotError(result);
  const payloads = check(result, [String]);
  return payloads.map(
    (payload) => runtime.serializer.parse(payload) as DurableExecutionState,
  );
}

/** One resumable legacy-data backfill batch; compare-and-set preserves concurrent writes. */
export async function rebuildExecutionIndex(
  runtime: RedisStoreRuntime,
  options: { cursor?: string; limit?: number },
): Promise<{ nextCursor: string | null }> {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    durableExecutionInvariantError.throw({
      message: "Index backfill limit must be an integer between 1 and 1000.",
    });
  }
  const scan = check(
    await runtime.redis.sscan(
      runtime.allExecutionsKey(),
      options.cursor ?? "0",
      "COUNT",
      limit,
    ),
    Match.Where(
      (value): value is [string, string[]] =>
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === "string" &&
        Array.isArray(value[1]) &&
        value[1].every((id: unknown) => typeof id === "string"),
    ),
  );
  const [cursor, ids] = scan;
  for (const id of ids) {
    const raw = await runtime.redis.get(runtime.executionKey(id));
    if (raw === null) {
      // Check and prune atomically: a concurrent recreation must not lose its index membership.
      await runtime.redis.eval(
        `
        if redis.call("exists", KEYS[1]) == 0 then redis.call("srem", KEYS[2], ARGV[1]) end
        return 1
      `,
        2,
        runtime.executionKey(id),
        runtime.allExecutionsKey(),
        id,
      );
      continue;
    }
    const payload = check(raw, String);
    const execution = runtime.serializer.parse(payload) as Execution;
    await runtime.redis.eval(
      `
      if redis.call("get", KEYS[1]) ~= ARGV[1] then return 0 end
      ${writeExecutionIndexScript("KEYS[2]", "KEYS[3]")}
      return 1
    `,
      3,
      runtime.executionKey(id),
      runtime.k("execution_index_metadata"),
      runtime.k("execution_index_states"),
      payload,
      id,
      "",
      "",
      "",
      ...executionIndexArgs(runtime, execution),
    );
  }
  return { nextCursor: cursor === "0" ? null : cursor };
}
