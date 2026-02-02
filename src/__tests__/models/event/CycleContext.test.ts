import { CycleContext } from "../../../models/event/CycleContext";

enum EventId {
  Sample = "evt",
}

enum EventSource {
  Initial = "initial",
  Hook = "hook-A",
}

describe("CycleContext", () => {
  it("runHook executes directly when disabled", async () => {
    const ctx = new CycleContext(false);
    const execute = jest.fn(async () => "ok");

    const result = await ctx.runHook("hook-id", execute);

    expect(result).toBe("ok");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("runEmission executes directly when disabled", async () => {
    const ctx = new CycleContext(false);
    const frame = { id: EventId.Sample, source: EventSource.Initial };
    let calls = 0;

    await ctx.runEmission(frame, EventSource.Initial, async () => {
      calls++;
      if (calls === 1) {
        await ctx.runEmission(frame, EventSource.Hook, async () => {
          calls++;
        });
      }
    });

    expect(calls).toBe(2);
  });

  it("detects emission cycles and throws", async () => {
    const ctx = new CycleContext(true);
    const frame = { id: "evt", source: "hook-A" };

    await expect(
      ctx.runEmission(frame, "hook-A", async () =>
        ctx.runEmission(frame, "hook-B", async () => {
          return;
        }),
      ),
    ).rejects.toThrow(/Event emission cycle detected/);
  });

  it("throws cycle error even when re-emitting as same source", async () => {
    const ctx = new CycleContext(true);
    const frame = { id: "evt", source: "hook-A" };
    const handler = jest.fn();

    await expect(
      ctx.runHook("hook-A", () =>
        ctx.runEmission(frame, "hook-A", async () =>
          ctx.runEmission(frame, "hook-A", async () => handler()),
        ),
      ),
    ).rejects.toThrow(/cycle detected/i);

    expect(handler).not.toHaveBeenCalled();
  });

  it("allows re-emitting same event if source changes (idempotency)", async () => {
    const ctx = new CycleContext(true);
    const frame1 = { id: "evt", source: "initial" };
    const frame2 = { id: "evt", source: "hook-A" };
    const handler = jest.fn();

    // Trace: External -> Hook A (id=hook-A) -> emit(evt, source=hook-A)
    // top (frame1, src=initial) != frame2 (src=hook-A). Allowed.
    await expect(
      ctx.runHook("hook-A", () =>
        ctx.runEmission(frame1, "hook-A", async () =>
          ctx.runEmission(frame2, "hook-A", async () => handler()),
        ),
      ),
    ).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("detects complex multi-step cycles (A->B->C->A)", async () => {
    const ctx = new CycleContext(true);
    const frameA = { id: "A", source: "ext" };
    const frameB = { id: "B", source: "hook-A" };
    const frameC = { id: "C", source: "hook-B" };
    const frameA_recurse = { id: "A", source: "hook-C" };

    await expect(
      ctx.runEmission(frameA, "ext", async () =>
        ctx.runEmission(frameB, "ext", async () =>
          ctx.runEmission(frameC, "ext", async () =>
            ctx.runEmission(frameA_recurse, "ext", async () => {}),
          ),
        ),
      ),
    ).rejects.toThrow(/cycle detected/i);
  });
});
