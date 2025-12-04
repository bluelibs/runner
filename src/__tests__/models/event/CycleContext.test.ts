import { CycleContext } from "../../../models/event/CycleContext";

describe("CycleContext", () => {
  it("runHook executes directly when disabled", async () => {
    const ctx = new CycleContext(false);
    const execute = jest.fn(async () => "ok");

    const result = await ctx.runHook("hook-id", execute);

    expect(result).toBe("ok");
    expect(execute).toHaveBeenCalledTimes(1);
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

  it("allows re-emitting same event from the same hook without cycle error", async () => {
    const ctx = new CycleContext(true);
    const frame = { id: "evt", source: "hook-A" };
    const handler = jest.fn();

    await expect(
      ctx.runHook("hook-A", () =>
        ctx.runEmission(frame, "hook-A", async () =>
          ctx.runEmission(frame, "hook-A", async () => handler()),
        ),
      ),
    ).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
