import { CycleContext } from "../../../models/event/CycleContext";

describe("CycleContext", () => {
  it("runHook executes directly when disabled", async () => {
    const ctx = new CycleContext(false);
    const execute = jest.fn(async () => "ok");

    const result = await ctx.runHook("hook-id", execute);

    expect(result).toBe("ok");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
