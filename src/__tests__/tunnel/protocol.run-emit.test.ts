import {
  runViaTunnel,
  emitViaTunnel,
  toTunnelError,
} from "../../globals/resources/tunnel/protocol";

describe("tunnel protocol - run/emit helpers", () => {
  it("runViaTunnel delegates to runner", async () => {
    const calls: any[] = [];
    const task: any = { id: "t" };
    const out = await runViaTunnel(
      async (t, input) => {
        calls.push({ t, input });
        return 7;
      },
      task,
      { a: 1 },
    );
    expect(out).toBe(7);
    expect(calls[0]).toEqual({ t: task, input: { a: 1 } });
  });

  it("emitViaTunnel delegates to runner", async () => {
    const calls: any[] = [];
    await emitViaTunnel(
      async (emission) => {
        calls.push(emission);
        return undefined;
      },
      { id: "e", data: { x: 1 } } as any,
    );
    expect(calls[0]).toEqual({ id: "e", data: { x: 1 } });
  });

  it("toTunnelError uses fallback message for unknown input", () => {
    const err = toTunnelError(undefined, "FB2");
    expect(err.message).toBe("FB2");
  });
});
