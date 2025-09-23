import { defineResource } from "../../define";
import { run } from "../../run";
import { globalTags } from "../../globals/globalTags";
import { event, hook } from "../../index";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";

describe("Tunnel delivery modes", () => {
  const ev = event<{ v: number }>({ id: "unit.tunnel.ev" });
  const captured: number[] = [];
  const h = hook({
    id: "unit.tunnel.h",
    on: ev,
    run: async (e: any) => captured.push(e.data.v),
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
});
