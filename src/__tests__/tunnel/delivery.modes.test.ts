import { defineResource } from "../../define";
import { run } from "../../run";
import { globalTags } from "../../globals/globalTags";
import { event, hook, task, globals } from "../../index";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";

describe("Tunnel delivery modes", () => {
  const ev = event<{ v: number }>({ id: "unit.tunnel.ev" });
  const captured: number[] = [];
  const h = hook({
    id: "unit.tunnel.h",
    on: ev,
    run: async (e: any) => captured.push(e.data.v),
  });
  const emitWithResult = task<{ v: number }, Promise<{ v: number }>>({
    id: "unit.tunnel.emitWithResult",
    dependencies: { eventManager: globals.resources.eventManager },
    run: async (input, { eventManager }) => {
      return await eventManager.emitWithResult(ev, input, "unit.tunnel.emitWithResult");
    },
  });

  function mkRunner(overrides: {
    delivery?: any;
    emitBehavior?: "ok" | "fail";
  }) {
    return defineResource({
      id: `unit.tunnel.delivery.${overrides.delivery || "mirror"}`,
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [ev.id],
        eventDeliveryMode: overrides.delivery,
        emit: async () => {
          if (overrides.emitBehavior === "fail") throw new Error("RFAIL");
        },
      }),
    });
  }

  beforeEach(() => {
    captured.length = 0;
  });

  it("mirror: delivers locally and attempts remote", async () => {
    const t = mkRunner({ delivery: "mirror", emitBehavior: "ok" });
    const app = defineResource({
      id: "app.mirror",
      register: [ev, h, t],
      init: async () => {},
    });
    const rr = await run(app);
    await rr.emitEvent(ev, { v: 1 });
    expect(captured).toEqual([1]);
    await rr.dispose();
  });

  it("remote-only: skips local listeners", async () => {
    const t = mkRunner({ delivery: "remote-only", emitBehavior: "ok" });
    const app = defineResource({
      id: "app.remoteOnly",
      register: [ev, h, t],
      init: async () => {},
    });
    const rr = await run(app);
    await rr.emitEvent(ev, { v: 2 });
    expect(captured).toEqual([]);
    await rr.dispose();
  });

  it("local-only: delivers only locally", async () => {
    const t = mkRunner({ delivery: "local-only", emitBehavior: "ok" });
    const app = defineResource({
      id: "app.localOnly",
      register: [ev, h, t],
      init: async () => {},
    });
    const rr = await run(app);
    await rr.emitEvent(ev, { v: 3 });
    expect(captured).toEqual([3]);
    await rr.dispose();
  });

  it("remote-first: falls back to local on remote failure", async () => {
    const t = mkRunner({ delivery: "remote-first", emitBehavior: "fail" });
    const app = defineResource({
      id: "app.remoteFirst",
      register: [ev, h, t],
      init: async () => {},
    });
    const rr = await run(app);
    await rr.emitEvent(ev, { v: 4 });
    expect(captured).toEqual([4]);
    await rr.dispose();
  });

  it("mirror: remote payload overrides final emission payload", async () => {
    const mutateLocal = hook({
      id: "unit.tunnel.h.mutate",
      on: ev,
      order: 0,
      run: async (e: any) => {
        e.data.v = e.data.v + 1;
      },
    });
    const captureAfter = hook({
      id: "unit.tunnel.h.captureAfter",
      on: ev,
      order: 1,
      run: async (e: any) => captured.push(e.data.v),
    });

    const t = defineResource({
      id: "unit.tunnel.delivery.mirror.returnPayload",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [ev.id],
        eventDeliveryMode: "mirror",
        emit: async (emission) => ({ v: emission.data.v + 10 }),
      }),
    });

    const app = defineResource({
      id: "app.mirror.returnPayload",
      register: [ev, mutateLocal, captureAfter, t, emitWithResult],
      init: async () => {},
    });

    const rr = await run(app);
    const out = await rr.runTask(emitWithResult, { v: 1 });
    expect(captured).toEqual([2]);
    expect(out).toEqual({ v: 12 });
    await rr.dispose();
  });

  it("remote-only: remote payload becomes final emission payload", async () => {
    const t = defineResource({
      id: "unit.tunnel.delivery.remote-only.returnPayload",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [ev.id],
        eventDeliveryMode: "remote-only",
        emit: async () => ({ v: 100 }),
      }),
    });

    const app = defineResource({
      id: "app.remoteOnly.returnPayload",
      register: [ev, h, t, emitWithResult],
      init: async () => {},
    });

    const rr = await run(app);
    const out = await rr.runTask(emitWithResult, { v: 1 });
    expect(captured).toEqual([]);
    expect(out).toEqual({ v: 100 });
    await rr.dispose();
  });

  it("remote-first: remote payload becomes final emission payload on success", async () => {
    const t = defineResource({
      id: "unit.tunnel.delivery.remote-first.returnPayload",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [ev.id],
        eventDeliveryMode: "remote-first",
        emit: async () => ({ v: 200 }),
      }),
    });

    const app = defineResource({
      id: "app.remoteFirst.returnPayload",
      register: [ev, h, t, emitWithResult],
      init: async () => {},
    });

    const rr = await run(app);
    const out = await rr.runTask(emitWithResult, { v: 1 });
    expect(captured).toEqual([]);
    expect(out).toEqual({ v: 200 });
    await rr.dispose();
  });
});
