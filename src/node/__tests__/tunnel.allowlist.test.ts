import { defineResource, defineTask, defineEvent } from "../../define";
import { run } from "../../run";
import type { Store } from "../../models/Store";
import { globalTags } from "../../globals/globalTags";
import { globalResources } from "../../globals/globalResources";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";
import { computeAllowList } from "../tunnel.allowlist";

describe("computeAllowList (server-mode http tunnels)", () => {
  it("returns disabled allow list when store lacks resources map", () => {
    const store = {
      tasks: new Map(),
      events: new Map(),
    } as unknown as Store;

    const list = computeAllowList(store);
    expect(list.enabled).toBe(false);
    expect(list.taskIds.size).toBe(0);
    expect(list.eventIds.size).toBe(0);
  });

  it("enabled=false when no server-mode http tunnels", async () => {
    const t = defineTask<{ v: number }, Promise<number>>({
      id: "allow.none.t",
      run: async ({ v }) => v,
    });
    const ev = defineEvent<{ n: number }>({ id: "allow.none.ev" });

    const clientTunnel = defineResource({
      id: "allow.none.client",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        transport: "http",
      }),
    });

    const app = defineResource({
      id: "allow.none.app",
      register: [t, ev, clientTunnel],
    });
    const rr = await run(app);
    const store = await rr.getResourceValue(globalResources.store as any);
    const list = computeAllowList(store);
    expect(list.enabled).toBe(false);
    expect(list.taskIds.size).toBe(0);
    expect(list.eventIds.size).toBe(0);
    await rr.dispose();
  });


  it("handles stores lacking resources map and skips non-object tunnel values", () => {
    const fakeStore = {
      resources: new Map([
        ["bad", { resource: { id: "bad", tags: [globalTags.tunnel] }, value: null }],
        [
          "srv",
          {
            resource: { id: "srv", tags: [globalTags.tunnel] },
            value: { mode: "server", transport: "http", tasks: [], events: [] },
          },
        ],
      ]),
      tasks: new Map([["t", { task: { id: "t" } }]]),
      events: new Map([["e", { event: { id: "e" } }]]),
    } as unknown as Store;

    const list = computeAllowList(fakeStore);
    expect(list.enabled).toBe(true);
  });
  it("collects ids for string/object arrays and ignores non-http or client tunnels", async () => {
    const t1 = defineTask<{ v: number }, Promise<number>>({
      id: "allow.t1",
      run: async ({ v }) => v,
    });
    const t2 = defineTask<{ v: number }, Promise<number>>({
      id: "allow.t2",
      run: async ({ v }) => v,
    });
    const t3 = defineTask<{ v: number }, Promise<number>>({
      id: "allow.t3",
      run: async ({ v }) => v,
    });
    const e1 = defineEvent<{ n: number }>({ id: "allow.e1" });
    const e2 = defineEvent<{ n: number }>({ id: "allow.e2" });

    // server http tunnel (strings + object)
    const srvHttp = defineResource({
      id: "allow.srv.http",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "server",
        transport: "http",
        tasks: [t1.id, t2],
        events: [e1.id],
      }),
    });

    // server ws tunnel (ignored)
    const srvWs = defineResource({
      id: "allow.srv.ws",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "server",
        transport: "ws",
        tasks: [t3.id],
      }),
    });

    // client http tunnel (ignored for allowlist)
    const cliHttp = defineResource({
      id: "allow.cli.http",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        transport: "http",
      }),
    });

    const app = defineResource({
      id: "allow.mixed.app",
      register: [t1, t2, t3, e1, e2, srvHttp, srvWs, cliHttp],
    });
    const rr = await run(app);
    const store = await rr.getResourceValue(globalResources.store as any);
    const list = computeAllowList(store);
    expect(list.enabled).toBe(true);
    expect(list.taskIds.has(t1.id)).toBe(true);
    expect(list.taskIds.has(t2.id)).toBe(true);
    expect(list.taskIds.has(t3.id)).toBe(false);
    expect(list.eventIds.has(e1.id)).toBe(true);
    expect(list.eventIds.has(e2.id)).toBe(false);
    await rr.dispose();
  });

  it("supports function selectors for tasks and events", async () => {
    const tA = defineTask<void, Promise<void>>({
      id: "func.tasks.a",
      run: async () => {},
    });
    const tB = defineTask<void, Promise<void>>({
      id: "func.tasks.b",
      run: async () => {},
    });
    const eA = defineEvent<void>({ id: "func.events.a" });
    const eB = defineEvent<void>({ id: "func.events.b" });

    const srv = defineResource({
      id: "func.srv",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "server",
        transport: "http",
        tasks: (t) => t.id.endsWith(".a"),
        events: (e) => e.id.endsWith(".b"),
      }),
    });

    const app = defineResource({
      id: "func.app",
      register: [tA, tB, eA, eB, srv],
    });
    const rr = await run(app);
    const store = await rr.getResourceValue(globalResources.store as any);
    const list = computeAllowList(store);
    expect(list.enabled).toBe(true);
    expect(list.taskIds.has(tA.id)).toBe(true);
    expect(list.taskIds.has(tB.id)).toBe(false);
    expect(list.eventIds.has(eA.id)).toBe(false);
    expect(list.eventIds.has(eB.id)).toBe(true);
    await rr.dispose();
  });

  it("ignores selector errors while continuing evaluation", () => {
    const tasks = new Map([
      ["good", { task: { id: "func.throw.tasks.good" } }],
      ["bad", { task: { id: "func.throw.tasks.bad" } }],
    ]);
    const events = new Map([
      ["good", { event: { id: "func.throw.events.good" } }],
      ["bad", { event: { id: "func.throw.events.bad" } }],
    ]);

    const store = {
      resources: new Map([
        [
          "srv",
          {
            resource: { id: "srv", tags: [globalTags.tunnel] },
            value: {
              mode: "server",
              transport: "http",
              tasks: (task: { id: string }) => {
                if (task.id.endsWith("bad")) {
                  throw new Error("task selector failure");
                }
                return task.id.endsWith("good");
              },
              events: (event: { id: string }) => {
                if (event.id.endsWith("bad")) {
                  throw new Error("event selector failure");
                }
                return event.id.endsWith("good");
              },
            } satisfies TunnelRunner,
          },
        ],
      ]),
      tasks,
      events,
    } as unknown as Store;

    const list = computeAllowList(store);
    expect(list.enabled).toBe(true);
    expect(list.taskIds.has("func.throw.tasks.good")).toBe(true);
    expect(list.taskIds.has("func.throw.tasks.bad")).toBe(false);
    expect(list.eventIds.has("func.throw.events.good")).toBe(true);
    expect(list.eventIds.has("func.throw.events.bad")).toBe(false);
  });
});
