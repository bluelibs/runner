import {
  runViaTunnel,
  emitViaTunnel,
  toTunnelError,
} from "../../globals/resources/tunnel/protocol";
import { ITask, IEventEmission } from "../../defs";

describe("tunnel protocol - run/emit helpers", () => {
  it("runViaTunnel delegates to runner", async () => {
    const calls: { t: { id: string }; input: unknown }[] = [];
    const task = { id: "t" };
    const out = await runViaTunnel(
      async (t, input) => {
        calls.push({ t, input });
        return 7;
      },
      task as unknown as ITask<any, any, any, any, any, any>,
      { a: 1 },
    );
    expect(out).toBe(7);
    expect(calls[0]).toEqual({ t: task, input: { a: 1 } });
  });

  it("emitViaTunnel delegates to runner", async () => {
    const calls: { id: string; data: unknown }[] = [];
    await emitViaTunnel(
      async (emission) => {
        calls.push(emission as { id: string; data: unknown });
        return undefined;
      },
      { id: "e", data: { x: 1 } } as unknown as IEventEmission<any>,
    );
    expect(calls[0]).toEqual({ id: "e", data: { x: 1 } });
  });

  it("toTunnelError uses fallback message for unknown input", () => {
    const err = toTunnelError(undefined, "FB2");
    expect(err.message).toBe("FB2");
  });
});
