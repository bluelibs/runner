import type { DurableCheckpointBranch } from "../core/interfaces/history";
import type { RedisStoreRuntime } from "./RedisStore.runtime";
import {
  executionIndexArgs,
  writeExecutionIndexScript,
} from "./RedisStore.executionIndex";
import { historyKey, historySequenceKey } from "./RedisStore.history";
import { isDeepStrictEqual } from "node:util";
import type { Execution } from "../core/types";

/** All payloads are opaque to Lua; custom application serializers stay intact. */
export async function createCheckpointExecution(
  runtime: RedisStoreRuntime,
  branch: DurableCheckpointBranch,
): Promise<boolean> {
  const expectedPayload = runtime.parseRedisString(
    await runtime.redis.get(runtime.executionKey(branch.expected.id)),
  );
  if (
    expectedPayload === null ||
    !isDeepStrictEqual(
      runtime.serializer.parse<Execution>(expectedPayload),
      branch.expected,
    )
  )
    return false;
  const history = branch.history.map(({ stateAfter, ...entry }) => [
    entry.stepId,
    JSON.stringify({
      ...entry,
      ...(stateAfter === undefined
        ? {}
        : {
            statePayload:
              stateAfter === null
                ? null
                : runtime.serializer.stringify(stateAfter),
          }),
    }),
  ]);
  const sequence = Math.max(
    ...branch.history.flatMap((entry) => [
      entry.startedOrder,
      entry.completedOrder ?? 0,
    ]),
  );
  const result = await runtime.redis.eval(
    `
    if redis.call("get", KEYS[1]) ~= ARGV[1] or redis.call("exists", KEYS[2]) == 1 then return 0 end
    redis.call("set", KEYS[2], ARGV[3])
    redis.call("sadd", KEYS[3], ARGV[2])
    redis.call("sadd", KEYS[4], ARGV[2])
    ${writeExecutionIndexScript("KEYS[5]", "KEYS[6]")}
    for _, step in ipairs(cjson.decode(ARGV[8])) do redis.call("hset", KEYS[7], step[1], step[2]) end
    for _, entry in ipairs(cjson.decode(ARGV[9])) do redis.call("hset", KEYS[8], entry[1], entry[2]) end
    redis.call("set", KEYS[9], ARGV[10])
    if ARGV[11] ~= "" then redis.call("set", KEYS[10], ARGV[11]) end
    return 1
  `,
    10,
    runtime.executionKey(branch.expected.id),
    runtime.executionKey(branch.execution.id),
    runtime.allExecutionsKey(),
    runtime.activeExecutionsKey(),
    runtime.k("execution_index_metadata"),
    runtime.k("execution_index_states"),
    runtime.stepBucketKey(branch.execution.id),
    historyKey(runtime, branch.execution.id),
    historySequenceKey(runtime, branch.execution.id),
    runtime.workflowStateKey(branch.execution.id),
    expectedPayload,
    branch.execution.id,
    runtime.serializer.stringify(branch.execution),
    "",
    "",
    ...executionIndexArgs(runtime, branch.execution),
    JSON.stringify(
      branch.steps.map((step) => [
        step.stepId,
        runtime.serializer.stringify(step),
      ]),
    ),
    JSON.stringify(history),
    sequence,
    branch.state
      ? runtime.serializer.stringify({
          executionId: branch.execution.id,
          state: branch.state.value,
          updatedAt: branch.execution.createdAt,
        })
      : "",
  );
  return result === 1;
}
