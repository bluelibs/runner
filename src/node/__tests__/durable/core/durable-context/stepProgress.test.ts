import { stepFixture, gate } from "./stepConcurrency.helpers";
import type { DurableStepContext } from "../../../../durable/core/interfaces/context";

describe("durable step progress and identity", () => {
  it("keeps idempotency stable and restores persisted progress across retries and contexts", async () => {
    jest.useFakeTimers();
    try {
      const fixture = await stepFixture();
      const keys: string[] = [];
      const attempts: number[] = [];
      const result = fixture.ctx.step(
        "import",
        { retries: 1 },
        async (step) => {
          keys.push(step.idempotencyKey);
          attempts.push(step.attempt);
          if (step.attempt === 1) {
            await step.heartbeat({ cursor: 12 });
            throw new Error("retry");
          }
          const progress = step.getProgress<{ cursor: number }>()!;
          progress.cursor = 99;
          expect(step.getProgress()).toEqual({ cursor: 12 });
          return "done";
        },
      );
      await jest.advanceTimersByTimeAsync(250);
      expect(await result).toBe("done");
      expect(keys[0]).toBe(keys[1]);
      expect(attempts).toEqual([1, 2]);
      expect(
        await fixture.replay().step("import", async () => "not called"),
      ).toBe("done");
    } finally {
      jest.useRealTimers();
    }
  });

  it("expires missing activity heartbeats and rejects late progress", async () => {
    jest.useFakeTimers();
    try {
      const fixture = await stepFixture();
      const blocked = gate();
      let active!: DurableStepContext;
      const run = fixture.ctx.step(
        "blocked",
        { heartbeatTimeoutMs: 30 },
        async (step) => {
          active = step;
          await blocked.promise;
          return "late";
        },
      );
      const outcome = run.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(31);
      expect(await outcome).toMatchObject({
        message: expect.stringContaining("heartbeat timed out"),
      });
      expect(active.signal.aborted).toBe(true);
      await expect(active.heartbeat({ late: true })).rejects.toThrow(
        "no longer owns",
      );
      expect(
        await fixture.store.getStepResult("execution", "blocked"),
      ).toBeNull();
      blocked.open();
    } finally {
      jest.useRealTimers();
    }
  });

  it("renews only after persisted progress and stops the deadline on settlement", async () => {
    jest.useFakeTimers();
    try {
      const fixture = await stepFixture();
      const blocked = gate();
      let active!: DurableStepContext;
      const run = fixture.ctx.step(
        "alive",
        { heartbeatTimeoutMs: 30 },
        async (step) => {
          active = step;
          await blocked.promise;
          return true;
        },
      );
      await jest.advanceTimersByTimeAsync(20);
      await active.heartbeat({ offset: 1 });
      await jest.advanceTimersByTimeAsync(20);
      expect(active.signal.aborted).toBe(false);
      blocked.open();
      expect(await run).toBe(true);
      await jest.advanceTimersByTimeAsync(100);
      expect(active.signal.aborted).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("retains the legacy context type and rejects invalid heartbeat deadlines", async () => {
    const fixture = await stepFixture();
    await expect(
      fixture.ctx.step("invalid", { heartbeatTimeoutMs: 0 }, async () => true),
    ).rejects.toThrow();
    const legacy = async ({ signal }: { signal: AbortSignal }) =>
      !signal.aborted;
    expect(await fixture.ctx.step("legacy", legacy)).toBe(true);
  });
});
