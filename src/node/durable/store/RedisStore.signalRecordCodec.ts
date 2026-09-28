import type { DurableSignalRecord, StepResult } from "../core/types";
import { durableExecutionInvariantError } from "../../../errors";
import type { RedisStoreRuntime } from "./RedisStore.runtime";

/**
 * A signal record as stored in Redis. Lua scripts decode and re-encode signal
 * state with cjson, which rewrites user data (`[]` becomes `{}`, floats lose
 * precision), so the payload travels as an already-serialized string that
 * Lua never decodes.
 */
type StoredSignalRecord = Omit<DurableSignalRecord, "payload"> & {
  encodedPayload: string;
};

const PAYLOAD_SLOT = "__runner_signal_payload_slot__";

export function encodeSignalRecord(
  runtime: RedisStoreRuntime,
  { payload, ...record }: DurableSignalRecord,
): string {
  const stored: StoredSignalRecord = {
    ...record,
    encodedPayload: runtime.serializer.stringify(payload),
  };
  return runtime.serializer.stringify(stored);
}

/** Records written before payloads were encoded are returned as stored. */
export function decodeSignalRecord(
  runtime: RedisStoreRuntime,
  stored: StoredSignalRecord | DurableSignalRecord,
): DurableSignalRecord {
  if (!("encodedPayload" in stored)) return stored;
  const { encodedPayload, ...record } = stored;
  return { ...record, payload: runtime.serializer.parse(encodedPayload) };
}

/**
 * Serializes a completed signal step around the spot where Lua splices in the
 * consumed record's encoded payload, so that payload is never decoded.
 */
export function splitAroundPayloadSlot(
  runtime: RedisStoreRuntime,
  stepResult: StepResult,
): [before: string, after: string] {
  const { result } = stepResult;
  if (typeof result !== "object" || result === null) {
    return durableExecutionInvariantError.throw({
      message: `Buffered signal step '${stepResult.stepId}' must complete with an object state.`,
    });
  }
  const parts = runtime.serializer
    .stringify({ ...stepResult, result: { ...result, payload: PAYLOAD_SLOT } })
    .split(JSON.stringify(PAYLOAD_SLOT));
  if (parts.length !== 2) {
    return durableExecutionInvariantError.throw({
      message: `Buffered signal step '${stepResult.stepId}' collides with the payload slot marker.`,
    });
  }
  return [parts[0], parts[1]];
}
