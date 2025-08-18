import {
  defineResource,
  defineTask,
  defineEvent,
  defineHook,
} from "../../define";
import { run } from "../../run";

describe("RunResult", () => {
  it("exposes runTask, emitEvent, getResourceValue, logger and they work", async () => {
    const double = defineTask({
      id: "helpers.double",
      run: async (x: number) => x * 2,
    });

    const acc = defineResource({
      id: "helpers.acc",
      async init() {
        return { calls: 0 } as { calls: number };
      },
    });

    const ping = defineEvent<{ n: number }>({ id: "helpers.ping" });

    const onPing = defineHook({
      id: "helpers.onPing",
      on: ping,
      dependencies: { acc },
      async run(e, deps) {
        deps.acc.calls += e.data.n;
      },
    });

    const app = defineResource({
      id: "helpers.app",
      register: [double, acc, ping, onPing],
      async init() {
        return "ready" as const;
      },
    });

    const r = await run(app);
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

    const value2 = r.getResourceValue(acc);
    expect(value2.calls).toBe(5);

    await r.dispose();
  });

  it("supports string ids for runTask, emitEvent, and getResourceValue", async () => {
    const acc = defineResource({
      id: "rr.acc",
      async init() {
        return { value: 0 } as { value: number };
      },
    });

    const inc = defineTask<{ by: number }, Promise<void>>({
      id: "rr.inc",
      dependencies: { acc },
      async run(i, d) {
        d.acc.value += i.by;
      },
    });

    const ping = defineEvent<{ n: number }>({ id: "rr.ping" });

    const onPing = defineHook({
      id: "rr.onPing",
      on: ping,
      dependencies: { acc },
      async run(e, d) {
        d.acc.value += e.data.n;
      },
    });

    const app = defineResource({
      id: "rr.app",
      register: [acc, inc, ping, onPing],
      async init() {
        return "ready" as const;
      },
    });

    const r = await run(app);

    await r.runTask("rr.inc", { by: 2 });
    await r.emitEvent("rr.ping", { n: 3 });
    const value = r.getResourceValue("rr.acc");
    expect(value.value).toBe(5);

    await r.dispose();
  });

  it("throws helpful errors for missing string ids", async () => {
    const app = defineResource({ id: "rr.empty" });
    const r = await run(app);

    expect(() => r.runTask("nope.task")).toThrow('Task "nope.task" not found.');
    expect(() => r.emitEvent("nope.event")).toThrow(
      'Event "nope.event" not found.',
    );
    expect(() => r.getResourceValue("nope.res")).toThrow(
      'Resource "nope.res" not found.',
    );

    await r.dispose();
  });
});
