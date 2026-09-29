import { StoreAdmissionController } from "../../../../durable/core/managers/StoreAdmissionController";
import { SuspensionSignal } from "../../../../durable/core/interfaces/context";
import { stepFixture } from "./stepConcurrency.helpers";

function advanceAfterAdmission(advance: () => void) {
  const original = StoreAdmissionController.prototype.tryAdmit;
  return jest
    .spyOn(StoreAdmissionController.prototype, "tryAdmit")
    .mockImplementation(async function (
      this: StoreAdmissionController,
      params,
    ) {
      const admission = await original.call(this, params);
      advance();
      return admission;
    });
}

describe("durable: step permit expiry during callback handoff", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("does not enter a callback after its numeric lease expires before the deadline timer runs", async () => {
    const { ctx, store } = await stepFixture();
    advanceAfterAdmission(() => {
      // Simulate waking from an event-loop pause with the callback microtask ahead of overdue timers.
      jest.setSystemTime(Date.now() + 31000);
      jest.spyOn(performance, "now").mockReturnValue(31000);
    });
    const body = jest.fn(async () => 42);
    await expect(ctx.step("charge", { concurrency: 1 }, body)).rejects.toThrow(
      "lock lost",
    );
    expect(body).not.toHaveBeenCalled();
    expect(await store.getStepResult("execution", "charge")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("parks an expired fixed-window grant rather than starting in the next window", async () => {
    jest.setSystemTime(new Date("2026-01-01T00:00:00.250Z"));
    const { ctx, store, replay } = await stepFixture();
    const handoff = advanceAfterAdmission(() => {
      jest.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    });
    const concurrency = { windowMs: 1000, max: 1 };
    const body = jest.fn(async () => 42);
    await expect(
      ctx.step("charge", { concurrency }, body),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(body).not.toHaveBeenCalled();
    expect(
      await store.getReadyTimers(new Date("2026-01-01T00:00:01.001Z")),
    ).toEqual([
      expect.objectContaining({ fireAt: new Date("2026-01-01T00:00:01.001Z") }),
    ]);
    handoff.mockRestore();
    await expect(replay().step("charge", { concurrency }, body)).resolves.toBe(
      42,
    );
    expect(body).toHaveBeenCalledTimes(1);
  });
});
