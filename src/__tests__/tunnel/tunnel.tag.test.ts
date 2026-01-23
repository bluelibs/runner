import {
  defineTask,
  defineResource,
  defineEvent,
  defineHook,
} from "../../define";
import { run } from "../../run";
import { globalTags } from "../../globals/globalTags";
import { IEventEmission } from "../../types/event";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";

describe("Tunnel Tag & Middleware", () => {
  it("overrides selected tasks via ids array", async () => {
    const t1 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.t1",
      run: async (input) => `ORIG1:${input?.v}`,
    });
    const t2 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.t2",
      run: async (input) => `ORIG2:${input?.v}`,
    });

    // Resource exposing a tunnel runner
    const tunnelRes = defineResource({
      id: "app.resources.tunnel",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t1.id],
        run: async (task: any, input: any) => `TUN:${task.id}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app",
      register: [t1, t2, tunnelRes],
      dependencies: { t1, t2, tunnelRes },
      init: async (_, { t1, t2 }) => {
        const a = await t1({ v: "A" });
        const b = await t2({ v: "B" });
        return { a, b };
      },
    });

    const rr = await run(app);
    const value = rr.value as any;
    expect(value.a).toBe("TUN:app.tasks.t1:A");
    expect(value.b).toBe("ORIG2:B");
    await rr.dispose();
  });

  it("overrides tasks via filter function", async () => {
    const t1 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.f1",
      run: async (input) => `OF1:${input?.v}`,
    });
    const t2 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.f2",
      run: async (input) => `OF2:${input?.v}`,
    });
    const t3 = defineTask<{ v: string }, Promise<string>>({
      id: "app.other.t3",
      run: async (input) => `O3:${input?.v}`,
    });

    const tunnelRes = defineResource({
      id: "app.resources.tunnel.filter",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: (task: any) => task.id.startsWith("app.tasks."),
        run: async (task: any, input: any) => `FT:${task.id}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app.filter",
      register: [t1, t2, t3, tunnelRes],
      dependencies: { t1, t2, t3, tunnelRes },
      init: async (_, { t1, t2, t3 }) => {
        const a = await t1({ v: "A" });
        const b = await t2({ v: "B" });
        const c = await t3({ v: "C" });
        return { a, b, c };
      },
    });

    const rr = await run(app);
    const value = rr.value as any;
    expect(value.a).toBe("FT:app.tasks.f1:A");
    expect(value.b).toBe("FT:app.tasks.f2:B");
    expect(value.c).toBe("O3:C");
    await rr.dispose();
  });

  it("overrides selected tasks in 'both' mode", async () => {
    const t1 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.both1",
      run: async (input) => `ORIG1:${input?.v}`,
    });
    const t2 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.both2",
      run: async (input) => `ORIG2:${input?.v}`,
    });

    const tunnelRes = defineResource({
      id: "app.resources.tunnel.both",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "both",
        tasks: [t1.id],
        run: async (task: any, input: any) => `BOTH:${task.id}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app.both.mode",
      register: [t1, t2, tunnelRes],
      dependencies: { t1, t2 },
      init: async (_, { t1, t2 }) => {
        const a = await t1({ v: "A" });
        const b = await t2({ v: "B" });
        return { a, b };
      },
    });

    const rr = await run(app);
    const value = rr.value as any;
    expect(value.a).toBe("BOTH:app.tasks.both1:A");
    expect(value.b).toBe("ORIG2:B");
    await rr.dispose();
  });

  it("throws when tasks includes a missing string id", async () => {
    const tunnelRes = defineResource({
      id: "app.resources.tunnel.missingId",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: ["app.tasks.unknown"],
        run: async (task: any, input: any) => `TUN:${task.id}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app.missingId",
      register: [tunnelRes],
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(
      "Task app.tasks.unknown not found while trying to resolve tasks for tunnel.",
    );
  });

  it("throws when tasks includes an unregistered task object", async () => {
    const notRegistered = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.unreg",
      run: async (input) => `ORIG:${input?.v}`,
    });

    const tunnelRes = defineResource({
      id: "app.resources.tunnel.unreg",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [notRegistered as any],
        run: async (task: any, input: any) => `TUN:${task.id}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app.unreg",
      register: [tunnelRes],
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(
      "Task [object Object] not found while trying to resolve tasks for tunnel.",
    );
  });

  it("overrides tasks via task object definitions", async () => {
    const t1 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.obj1",
      run: async (input) => `ORIG1:${input?.v}`,
    });
    const t2 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.obj2",
      run: async (input) => `ORIG2:${input?.v}`,
    });

    const tunnelRes = defineResource({
      id: "app.resources.tunnel.objects",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t1],
        run: async (task: any, input: any) => `OBJ:${task.id}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app.objects",
      register: [t1, t2, tunnelRes],
      dependencies: { t1, t2 },
      init: async (_, { t1, t2 }) => {
        const a = await t1({ v: "A" });
        const b = await t2({ v: "B" });
        return { a, b };
      },
    });

    const rr = await run(app);
    const value = rr.value as any;
    expect(value.a).toBe("OBJ:app.tasks.obj1:A");
    expect(value.b).toBe("ORIG2:B");
    await rr.dispose();
  });
});

describe("Tunnel Events", () => {
  it("routes selected events via ids and also runs local listeners", async () => {
    const ev = defineEvent<{ v: string }>({ id: "app.events.e1" });
    let handled = false;
    const h = defineHook({
      id: "app.hooks.h1",
      on: ev,
      run: async () => {
        handled = true;
      },
    });

    const captured: Array<{ id: string; v: string }> = [];
    const tunnelRes = defineResource({
      id: "app.resources.tunnel.events",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [ev.id],
        emit: async (eventEmission: IEventEmission<any>) => {
          captured.push({ id: eventEmission.id, v: eventEmission.data?.v });
        },
      }),
    });

    const app = defineResource({
      id: "app.events.app",
      register: [ev, h, tunnelRes],
      dependencies: { ev },
      init: async (_, { ev }) => {
        // emit normally, but should be routed through tunnel
        return ev({ v: "X" });
      },
    });

    const rr = await run(app);
    expect(handled).toBe(true);
    expect(captured).toEqual([{ id: "app.events.e1", v: "X" }]);
    await rr.dispose();
  });

  it("throws when events includes a missing id", async () => {
    const tunnelRes = defineResource({
      id: "app.events.tunnel.missing",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: ["app.events.unknown"],
        emit: async () => {},
      }),
    });

    const app = defineResource({
      id: "app.events.missing",
      register: [tunnelRes],
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(
      "Event app.events.unknown not found while trying to resolve events for tunnel.",
    );
  });

  it("enforces emit when events[] configured and run when tasks[] configured", async () => {
    const ev = defineEvent<{ a: number }>({ id: "app.events.needEmit" });
    const t = defineTask({ id: "app.tasks.needRun", run: async () => 1 });

    const missingEmit = defineResource({
      id: "app.tunnel.missingEmit",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> =>
        ({ mode: "client", events: [ev.id] }) as any,
    });
    const missingRun = defineResource({
      id: "app.tunnel.missingRun",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> =>
        ({ mode: "client", tasks: [t.id] }) as any,
    });

    await expect(
      run(
        defineResource({
          id: "app.wrap1",
          register: [ev, missingEmit],
        }) as any,
      ),
    ).rejects.toThrow("must implement emit(event, payload)");

    await expect(
      run(
        defineResource({
          id: "app.wrap2",
          register: [t, missingRun],
        }) as any,
      ),
    ).rejects.toThrow("must implement run(task, input)");
  });

  it("should default to none mode", async () => {
    const t1 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.server1",
      run: async (input) => `SRV1:${input?.v}`,
    });
    const tunnelRes = defineResource({
      id: "app.resources.tunnel.none",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        tasks: [t1.id],
        run: async () => `NOPE`,
      }),
    });
    const app = defineResource({
      id: "app.none.mode",
      register: [t1, tunnelRes],
      dependencies: { t1 },
      init: async (_, { t1 }) => {
        const a = await t1({ v: "A" });
        return { a };
      },
    });
    const rr = await run(app);
    const val = rr.value as any;
    expect(val.a).toBe("SRV1:A");
    await rr.dispose();
  });

  it("does not override in server mode (tasks/events)", async () => {
    // Task side
    const t1 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.server1",
      run: async (input) => `SRV1:${input?.v}`,
    });
    const t2 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.server2",
      run: async (input) => `SRV2:${input?.v}`,
    });
    // Event side
    const ev = defineEvent<{ m: string }>({ id: "app.events.server" });
    let handled = false;
    const h = defineHook({
      id: "app.hooks.server",
      on: ev,
      run: async () => {
        handled = true;
      },
    });

    const tunnelRes = defineResource({
      id: "app.resources.tunnel.server",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "server",
        tasks: [t1.id],
        events: [ev.id],
        run: async () => `NOPE`,
        emit: async () => {},
      }),
    });

    const app = defineResource({
      id: "app.server.mode",
      register: [t1, t2, ev, h, tunnelRes],
      dependencies: { t1, t2, ev },
      init: async (_, { t1, t2, ev }) => {
        const a = await t1({ v: "A" });
        const b = await t2({ v: "B" });
        await ev({ m: "X" });
        return { a, b };
      },
    });

    const rr = await run(app);
    const val = rr.value as any;
    expect(val.a).toBe("SRV1:A");
    expect(val.b).toBe("SRV2:B");
    expect(handled).toBe(true);
    await rr.dispose();
  });

  it("routes events via function selector", async () => {
    const ev = defineEvent<{ p: number }>({ id: "app.events.func" });
    const captured: Array<number> = [];
    const tunnelRes = defineResource({
      id: "app.resources.tunnel.fn",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: (e: any) => e.id === ev.id,
        emit: async (e: IEventEmission<any>) => captured.push(e.data?.p),
      }),
    });

    const app = defineResource({
      id: "app.events.fn",
      register: [ev, tunnelRes],
      dependencies: { ev },
      init: async (_, { ev }) => ev({ p: 7 }),
    });

    const rr = await run(app);
    expect(captured).toEqual([7]);
    await rr.dispose();
  });

  it("routes events when provided as object definitions", async () => {
    const ev = defineEvent<{ z: string }>({ id: "app.events.obj" });
    const captured: string[] = [];
    const tunnelRes = defineResource({
      id: "app.resources.tunnel.obj",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [ev],
        emit: async (e: IEventEmission<any>) => captured.push(e.data?.z),
      }),
    });

    const app = defineResource({
      id: "app.events.obj.app",
      register: [ev, tunnelRes],
      dependencies: { ev },
      init: async (_, { ev }) => ev({ z: "OK" }),
    });

    const rr = await run(app);
    expect(captured).toEqual(["OK"]);
    await rr.dispose();
  });
});
