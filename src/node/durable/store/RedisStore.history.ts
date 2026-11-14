import { check, Match } from "../../../tools/check";
import type {
  DurableHistoryEntry,
  DurableHistoryUpdate,
} from "../core/interfaces/history";
import type { RedisStoreRuntime } from "./RedisStore.runtime";

const entryPattern = Match.compile({
  stepId: String,
  kind: Match.OneOf(
    "step",
    "workflow",
    "continue",
    "sleep",
    "signal",
    "execution",
    "switch",
    "state",
    "command",
    "origin",
  ),
  parentStepId: Match.Optional(String),
  taskKey: Match.Optional(String),
  startedOrder: Number,
  completedOrder: Match.Optional(Number),
  statePayload: Match.Optional(Match.OneOf(String, null)),
});

export function historyKey(runtime: RedisStoreRuntime, id: string): string {
  return runtime.k(`history:${runtime.encodeKeyPart(id)}`);
}
export function historySequenceKey(
  runtime: RedisStoreRuntime,
  id: string,
): string {
  return runtime.k(`history_sequence:${runtime.encodeKeyPart(id)}`);
}

/** Common script fragment also used when a command commits workflow state. */
export const recordHistoryScript = `
  local update = cjson.decode(ARGV[1])
  local raw = redis.call("hget", KEYS[1], update.stepId)
  local entry
  if raw then entry = cjson.decode(raw)
  else
    entry = {stepId=update.stepId, kind=update.kind, parentStepId=update.parentStepId,
      taskKey=update.taskKey, startedOrder=redis.call("incr", KEYS[2])}
  end
  if update.phase == "completed" and not entry.completedOrder then
    entry.completedOrder = redis.call("incr", KEYS[2])
    entry.statePayload = update.statePayload
  end
  redis.call("hset", KEYS[1], entry.stepId, cjson.encode(entry))
  return 1
`;

export async function recordExecutionHistory(
  runtime: RedisStoreRuntime,
  id: string,
  update: DurableHistoryUpdate,
): Promise<void> {
  const { stateAfter, ...identity } = update;
  await runtime.redis.eval(
    recordHistoryScript,
    2,
    historyKey(runtime, id),
    historySequenceKey(runtime, id),
    JSON.stringify({
      ...identity,
      ...("stateAfter" in update
        ? {
            statePayload:
              stateAfter === null
                ? null
                : runtime.serializer.stringify(stateAfter),
          }
        : {}),
    }),
  );
}

export async function listExecutionHistory(
  runtime: RedisStoreRuntime,
  id: string,
): Promise<DurableHistoryEntry[]> {
  const raw = check(
    await runtime.redis.hgetall(historyKey(runtime, id)),
    Match.MapOf(String),
  );
  return Object.values(raw)
    .map((payload) => {
      const { statePayload, ...entry } = entryPattern.parse(
        JSON.parse(payload),
      );
      return {
        ...entry,
        ...(statePayload === undefined
          ? {}
          : {
              stateAfter:
                statePayload === null
                  ? null
                  : runtime.serializer.parse<{ value: unknown }>(statePayload),
            }),
      };
    })
    .sort((a, b) => a.startedOrder - b.startedOrder);
}
