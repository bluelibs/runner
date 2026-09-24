import { RedisStoreRuntime } from "../../../durable/store/RedisStore.runtime";
import type { RedisClient } from "../../../durable/store/RedisStore.runtime";
import {
  decodeSignalRecord,
  encodeSignalRecord,
  splitAroundPayloadSlot,
} from "../../../durable/store/RedisStore.signalRecordCodec";

const runtime = new RedisStoreRuntime({} as RedisClient, "durable:", false);
const record = {
  id: "r1",
  payload: { items: [], ratio: 0.1 + 0.2 },
  receivedAt: new Date(0),
};
const step = (stepId: string, result: unknown) => ({
  executionId: "e1",
  stepId,
  result,
  completedAt: new Date(0),
});

describe("durable: RedisStore signal record codec", () => {
  it("round-trips records with the payload kept as an opaque string", () => {
    const encoded = encodeSignalRecord(runtime, record);

    expect(JSON.parse(encoded)).toEqual({
      id: "r1",
      encodedPayload: expect.any(String),
      receivedAt: expect.anything(),
    });
    expect(
      decodeSignalRecord(runtime, runtime.serializer.parse(encoded)),
    ).toEqual(record);
  });

  it("returns records stored before payload encoding as they are", () => {
    expect(decodeSignalRecord(runtime, record)).toBe(record);
  });

  it("splits a completed step around the payload slot", () => {
    const [before, after] = splitAroundPayloadSlot(
      runtime,
      step("__signal:paid", { state: "completed" }),
    );

    expect(
      runtime.serializer.parse(`${before}${JSON.stringify([1])}${after}`),
    ).toEqual(step("__signal:paid", { state: "completed", payload: [1] }));
  });

  it("fails fast on a non-object completion state or a slot collision", () => {
    expect(() =>
      splitAroundPayloadSlot(runtime, step("__signal:paid", "done")),
    ).toThrow("must complete with an object state");
    expect(() =>
      splitAroundPayloadSlot(
        runtime,
        step("__runner_signal_payload_slot__", { state: "completed" }),
      ),
    ).toThrow("collides with the payload slot marker");
  });
});
