import { resource, task, event, hook, run } from "../index";

describe("run() helpers facade", () => {
  it("exposes runTask, emitEvent, getResourceValue, logger and they work", async () => {
    const double = task({
      id: "helpers.double",
      run: async (x: number) => x * 2,
    });

    const acc = resource({
      id: "helpers.acc",
      async init() {
        return { calls: 0 } as { calls: number };
      },
    });

    const ping = event<{ n: number }>({ id: "helpers.ping" });

    const onPing = hook({
      id: "helpers.onPing",
      on: ping,
      dependencies: { acc },
      async run(e, deps) {
        deps.acc.calls += e.data.n;
      },
    });

    const app = resource({
      id: "helpers.app",
      register: [double, acc, ping, onPing],
      async init() {
        return "ready" as const;
      },
    });

    const r = await run(app, { logs: { printThreshold: null } });
    expect(typeof r.runTask).toBe("function");
    expect(typeof r.emitEvent).toBe("function");
    expect(typeof r.getResourceValue).toBe("function");
    expect(r.logger).toBeDefined();

    const out = await r.runTask(double, 21);
    expect(out).toBe(42);

    await r.emitEvent(ping, { n: 2 });
    await r.emitEvent(ping, { n: 3 });

    const value = r.getResourceValue("helpers.acc");
    expect(value.calls).toBe(5);

    await r.dispose();
  });
});
