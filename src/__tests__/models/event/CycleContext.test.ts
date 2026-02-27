import { CycleContext } from "../../../models/event/CycleContext";
import { runtimeSource } from "../../../types/runtimeSource";

enum EventId {
  Sample = "evt",
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
    const frame = {
      id: EventId.Sample,
      source: runtimeSource.runtime("initial"),
    };
    let calls = 0;

    await ctx.runEmission(frame, async () => {
      calls++;
      if (calls === 1) {
        await ctx.runEmission(
          {
            id: EventId.Sample,
            source: runtimeSource.hook("hook-A"),
          },
          async () => {
            calls++;
          },
        );
      }
    });

    expect(calls).toBe(2);
  });

  it("detects emission cycles and throws", async () => {
    const ctx = new CycleContext(true);
    const frame = { id: "evt", source: runtimeSource.hook("hook-A") };

    await expect(
      ctx.runEmission(frame, async () =>
        ctx.runEmission(
          { id: "evt", source: runtimeSource.hook("hook-B") },
          async () => {
            return;
          },
        ),
      ),
    ).rejects.toThrow(/Event emission cycle detected/);
  });

  it("throws cycle error even when re-emitting as same source", async () => {
    const ctx = new CycleContext(true);
    const frame = { id: "evt", source: runtimeSource.hook("hook-A") };
    const handler = jest.fn();

    await expect(
      ctx.runHook("hook-A", () =>
        ctx.runEmission(frame, async () =>
          ctx.runEmission(frame, async () => handler()),
        ),
      ),
    ).rejects.toThrow(/cycle detected/i);

    expect(handler).not.toHaveBeenCalled();
  });

  it("allows re-emitting same event if source changes (idempotency)", async () => {
    const ctx = new CycleContext(true);
    const frame1 = { id: "evt", source: runtimeSource.runtime("initial") };
    const frame2 = { id: "evt", source: runtimeSource.hook("hook-A") };
    const handler = jest.fn();

    // Trace: External -> Hook A (id=hook-A) -> emit(evt, source=hook-A)
    // top (frame1, src=initial) != frame2 (src=hook-A). Allowed.
    await expect(
      ctx.runHook("hook-A", () =>
        ctx.runEmission(frame1, async () =>
          ctx.runEmission(frame2, async () => handler()),
        ),
      ),
    ).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("detects complex multi-step cycles (A->B->C->A)", async () => {
    const ctx = new CycleContext(true);
    const frameA = { id: "A", source: runtimeSource.runtime("ext") };
    const frameB = { id: "B", source: runtimeSource.hook("hook-A") };
    const frameC = { id: "C", source: runtimeSource.hook("hook-B") };
    const frameARecurse = { id: "A", source: runtimeSource.hook("hook-C") };

    await expect(
      ctx.runEmission(frameA, async () =>
        ctx.runEmission(frameB, async () =>
          ctx.runEmission(frameC, async () =>
            ctx.runEmission(frameARecurse, async () => {}),
          ),
        ),
      ),
    ).rejects.toThrow(/cycle detected/i);
  });

  it("detects alternating hook re-emits on the same event", async () => {
    const ctx = new CycleContext(true);
    const frameInitial = {
      id: "evt",
      source: runtimeSource.runtime("initial"),
    };
    const frameA = { id: "evt", source: runtimeSource.hook("hook-A") };
    const frameB = { id: "evt", source: runtimeSource.hook("hook-B") };

    await expect(
      ctx.runHook("hook-A", () =>
        ctx.runEmission(frameInitial, async () =>
          ctx.runHook("hook-B", () =>
            ctx.runEmission(frameA, async () =>
              ctx.runHook("hook-A", () =>
                ctx.runEmission(frameB, async () => {}),
              ),
            ),
          ),
        ),
      ),
    ).rejects.toThrow(/cycle detected/i);
  });

  it("fails fast when emission stack depth exceeds safety cap", async () => {
    const ctx = new CycleContext(true);
    if (!ctx.isEnabled) {
      return;
    }

    const internals = ctx as unknown as {
      emissionStack: { getStore: () => Array<{ id: string; source: any }> };
    };

    const deepStack = Array.from({ length: 1000 }, () => ({
      id: "evt.previous",
      source: runtimeSource.runtime("deep.stack"),
    }));

    jest.spyOn(internals.emissionStack, "getStore").mockReturnValue(deepStack);

    expect(() =>
      ctx.runEmission(
        {
          id: "evt.overflow",
          source: runtimeSource.runtime("overflow"),
        },
        async () => undefined,
      ),
    ).toThrow(/Emission stack exceeded 1000 frames/);
  });
});
