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
    eventId: string;
    delivery?: TunnelRunner["eventDeliveryMode"];
    emitBehavior?: "ok" | "fail";
  }) {
    return defineResource({
      id: `unit.tunnel.delivery.${overrides.delivery || "mirror"}`,
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [overrides.eventId],
        eventDeliveryMode: overrides.delivery,
        emit: async () => {
          if (overrides.emitBehavior === "fail") throw new Error("RFAIL");
        },
      }),
    });
  }

  it("supports mirror, remote-only, local-only and remote-first", async () => {
    const captured: Record<string, number[]> = {
      mirror: [],
      remoteOnly: [],
      localOnly: [],
      remoteFirst: [],
    };

    const mirrorEvent = event<{ v: number }>({ id: "unit.tunnel.ev.mirror" });
    const remoteOnlyEvent = event<{ v: number }>({
      id: "unit.tunnel.ev.remoteOnly",
    });
    const localOnlyEvent = event<{ v: number }>({
      id: "unit.tunnel.ev.localOnly",
    });
    const remoteFirstEvent = event<{ v: number }>({
      id: "unit.tunnel.ev.remoteFirst",
    });

    const mirrorHook = hook({
      id: "unit.tunnel.h.mirror",
      on: mirrorEvent,
      run: async (e: { data: { v: number } }) => captured.mirror.push(e.data.v),
    });
    const remoteOnlyHook = hook({
      id: "unit.tunnel.h.remoteOnly",
      on: remoteOnlyEvent,
      run: async (e: { data: { v: number } }) =>
        captured.remoteOnly.push(e.data.v),
    });
    const localOnlyHook = hook({
      id: "unit.tunnel.h.localOnly",
      on: localOnlyEvent,
      run: async (e: { data: { v: number } }) =>
        captured.localOnly.push(e.data.v),
    });
    const remoteFirstHook = hook({
      id: "unit.tunnel.h.remoteFirst",
      on: remoteFirstEvent,
      run: async (e: { data: { v: number } }) =>
        captured.remoteFirst.push(e.data.v),
    });

    const mirrorRunner = mkRunner({
      eventId: mirrorEvent.id,
      delivery: "mirror",
      emitBehavior: "ok",
    });
    const remoteOnlyRunner = mkRunner({
      eventId: remoteOnlyEvent.id,
      delivery: "remote-only",
      emitBehavior: "ok",
    });
    const localOnlyRunner = mkRunner({
      eventId: localOnlyEvent.id,
      delivery: "local-only",
      emitBehavior: "ok",
    });
    const remoteFirstRunner = mkRunner({
      eventId: remoteFirstEvent.id,
      delivery: "remote-first",
      emitBehavior: "fail",
    });

    const app = defineResource({
      id: "app.deliveryModes",
      register: [
        mirrorEvent,
        remoteOnlyEvent,
        localOnlyEvent,
        remoteFirstEvent,
        mirrorHook,
        remoteOnlyHook,
        localOnlyHook,
        remoteFirstHook,
        mirrorRunner,
        remoteOnlyRunner,
        localOnlyRunner,
        remoteFirstRunner,
      ],
      init: async () => {},
    });

    const rr = await run(app);

    await rr.emitEvent(mirrorEvent, { v: 1 });
    await rr.emitEvent(remoteOnlyEvent, { v: 2 });
    await rr.emitEvent(localOnlyEvent, { v: 3 });
    await rr.emitEvent(remoteFirstEvent, { v: 4 });

    expect(captured.mirror).toEqual([1]);
    expect(captured.remoteOnly).toEqual([]);
    expect(captured.localOnly).toEqual([3]);
    expect(captured.remoteFirst).toEqual([4]);

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
