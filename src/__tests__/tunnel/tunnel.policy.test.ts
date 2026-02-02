import { resource, task, run, taskMiddleware, globals } from "../..";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";

describe("Tunnel Policy (task-level whitelist)", () => {
  it("runs only whitelisted client middlewares when tunneled (by id)", async () => {
    let calledA = 0;
    let calledB = 0;

    const mwA = taskMiddleware({
      id: "tests.policy.mwA",
      run: async ({ next, task }) => {
        calledA++;
        return next(task.input);
      },
    });
    const mwB = taskMiddleware({
      id: "tests.policy.mwB",
      run: async ({ next, task }) => {
        calledB++;
        return next(task.input);
      },
    });

    const t = task<{ v: number }, Promise<string>>({
      id: "tests.policy.task",
      // Whitelist only mwA locally on caller side
      tags: [
        globals.tags.tunnelPolicy.with({
          client: { middlewareAllowList: [mwA.id] },
        }),
      ],
      middleware: [mwA, mwB],
      run: async () => "local-should-not-run",
    });

    // Tunnel overrides .run; local chain should filter middlewares by tag whitelist
    const tunnel = resource({
      id: "tests.policy.tunnel",
      tags: [globals.tags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t],
        run: async () => "remote", // remote handler
      }),
    });

    const app = resource({
      id: "tests.policy.app",
      register: [mwA, mwB, t, tunnel],
    });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(calledA).toBe(1);
    expect(calledB).toBe(0);
  });

  it("runs only whitelisted client middlewares when tunneled (by def object)", async () => {
    let calledA = 0;
    let calledB = 0;

    const mwA = taskMiddleware({
      id: "tests.policy.mwA2",
      run: async ({ next, task }) => {
        calledA++;
        return next(task.input);
      },
    });
    const mwB = taskMiddleware({
      id: "tests.policy.mwB2",
      run: async ({ next, task }) => {
        calledB++;
        return next(task.input);
      },
    });

    const t = task<{ v: number }, Promise<string>>({
      id: "tests.policy.task2",
      // Whitelist only mwB locally using object form
      tags: [
        globals.tags.tunnelPolicy.with({
          client: { middlewareAllowList: [mwB] },
        }),
      ],
      middleware: [mwA, mwB],
      run: async () => "local-should-not-run",
    });

    const tunnel = resource({
      id: "tests.policy.tunnel2",
      tags: [globals.tags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t],
        run: async () => "remote", // remote handler
      }),
    });

    const app = resource({
      id: "tests.policy.app2",
      register: [mwA, mwB, t, tunnel],
    });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(calledA).toBe(0);
    expect(calledB).toBe(1);
  });

  it("runs no local middlewares by default (no tag) when tunneled", async () => {
    let calledA = 0;
    let calledB = 0;

    const mwA = taskMiddleware({
      id: "tests.policy.mwA3",
      run: async ({ next, task }) => {
        calledA++;
        return next(task.input);
      },
    });
    const mwB = taskMiddleware({
      id: "tests.policy.mwB3",
      run: async ({ next, task }) => {
        calledB++;
        return next(task.input);
      },
    });

    const t = task<{ v: number }, Promise<string>>({
      id: "tests.policy.task3",
      middleware: [mwA, mwB],
      run: async () => "local-should-not-run",
    });

    const tunnel = resource({
      id: "tests.policy.tunnel3",
      tags: [globals.tags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t],
        run: async () => "remote",
      }),
    });

    const app = resource({
      id: "tests.policy.app3",
      register: [mwA, mwB, t, tunnel],
    });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(calledA).toBe(0);
    expect(calledB).toBe(0);
  });

  it("runs no local middlewares when only server policy is specified", async () => {
    let calledA = 0;
    let calledB = 0;

    const mwA = taskMiddleware({
      id: "tests.policy.mwA5",
      run: async ({ next, task }) => {
        calledA++;
        return next(task.input);
      },
    });
    const mwB = taskMiddleware({
      id: "tests.policy.mwB5",
      run: async ({ next, task }) => {
        calledB++;
        return next(task.input);
      },
    });

    const t = task<{ v: number }, Promise<string>>({
      id: "tests.policy.task5",
      // Tag present but only server key set; client allowlist is not set -> no local middleware
      tags: [
        globals.tags.tunnelPolicy.with({
          server: { middlewareAllowList: [mwA.id] },
        }),
      ],
      middleware: [mwA, mwB],
      run: async () => "local-should-not-run",
    });

    const tunnel = resource({
      id: "tests.policy.tunnel5",
      tags: [globals.tags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t],
        run: async () => "remote",
      }),
    });

    const app = resource({
      id: "tests.policy.app5",
      register: [mwA, mwB, t, tunnel],
    });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(calledA).toBe(0);
    expect(calledB).toBe(0);
  });

  it("runs no local middlewares when client whitelist is empty array", async () => {
    let calledA = 0;
    let calledB = 0;

    const mwA = taskMiddleware({
      id: "tests.policy.mwA4",
      run: async ({ next, task }) => {
        calledA++;
        return next(task.input);
      },
    });
    const mwB = taskMiddleware({
      id: "tests.policy.mwB4",
      run: async ({ next, task }) => {
        calledB++;
        return next(task.input);
      },
    });

    const t = task<{ v: number }, Promise<string>>({
      id: "tests.policy.task4",
      tags: [
        globals.tags.tunnelPolicy.with({
          client: { middlewareAllowList: [] },
        }),
      ],
      middleware: [mwA, mwB],
      run: async () => "local-should-not-run",
    });

    const tunnel = resource({
      id: "tests.policy.tunnel4",
      tags: [globals.tags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t],
        run: async () => "remote",
      }),
    });

    const app = resource({
      id: "tests.policy.app4",
      register: [mwA, mwB, t, tunnel],
    });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(calledA).toBe(0);
    expect(calledB).toBe(0);
  });

  it("supports legacy shorthand { client: [...] }", async () => {
    let called = 0;

    const mw = taskMiddleware({
      id: "tests.policy.legacyMw",
      run: async ({ next, task }) => {
        called++;
        return next(task.input);
      },
    });

    const t = task<{ v: number }, Promise<string>>({
      id: "tests.policy.legacyTask",
      tags: [globals.tags.tunnelPolicy.with({ client: [mw.id] })],
      middleware: [mw],
      run: async () => "local-should-not-run",
    });

    const tunnel = resource({
      id: "tests.policy.legacyTunnel",
      tags: [globals.tags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t],
        run: async () => "remote",
      }),
    });

    const app = resource({
      id: "tests.policy.legacyApp",
      register: [mw, t, tunnel],
    });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(called).toBe(1);
  });

  it("runs no local middlewares when tag exists but has no config (unconfigured tag)", async () => {
    let calledA = 0;
    let calledB = 0;

    const mwA = taskMiddleware({
      id: "tests.policy.unconfiguredMwA",
      run: async ({ next, task }) => {
        calledA++;
        return next(task.input);
      },
    });
    const mwB = taskMiddleware({
      id: "tests.policy.unconfiguredMwB",
      run: async ({ next, task }) => {
        calledB++;
        return next(task.input);
      },
    });

    const t = task<{ v: number }, Promise<string>>({
      id: "tests.policy.unconfiguredTask",
      tags: [globals.tags.tunnelPolicy],
      middleware: [mwA, mwB],
      run: async () => "local-should-not-run",
    });

    const tunnel = resource({
      id: "tests.policy.unconfiguredTunnel",
      tags: [globals.tags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t],
        run: async () => "remote",
      }),
    });

    const app = resource({
      id: "tests.policy.unconfiguredApp",
      register: [mwA, mwB, t, tunnel],
    });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(calledA).toBe(0);
    expect(calledB).toBe(0);
  });

  it("supports previous grouped config { middlewareAllowList: { client: [...] } }", async () => {
    let called = 0;

    const mw = taskMiddleware({
      id: "tests.policy.groupedMw",
      run: async ({ next, task }) => {
        called++;
        return next(task.input);
      },
    });

    const t = task<{ v: number }, Promise<string>>({
      id: "tests.policy.groupedTask",
      tags: [
        globals.tags.tunnelPolicy.with({
          middlewareAllowList: { client: [mw.id] },
        }),
      ],
      middleware: [mw],
      run: async () => "local-should-not-run",
    });

    const tunnel = resource({
      id: "tests.policy.groupedTunnel",
      tags: [globals.tags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t],
        run: async () => "remote",
      }),
    });

    const app = resource({
      id: "tests.policy.groupedApp",
      register: [mw, t, tunnel],
    });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(called).toBe(1);
  });
});
