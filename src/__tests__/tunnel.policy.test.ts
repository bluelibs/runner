import { resource, task, run, taskMiddleware, globals } from "..";

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
      tags: [globals.tags.tunnelPolicy.with({ client: [mwA.id] })],
      middleware: [mwA, mwB],
      run: async () => "local-should-not-run",
    });

    // Tunnel overrides .run; local chain should filter middlewares by tag whitelist
    const tunnel = resource({
      id: "tests.policy.tunnel",
      tags: [globals.tags.tunnel.with({ mode: "client", tasks: [t] })],
      init: async () => ({
        run: async () => "remote", // remote handler
      }),
    });

    const app = resource({ id: "tests.policy.app", register: [mwA, mwB, t, tunnel] });
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
      tags: [globals.tags.tunnelPolicy.with({ client: [mwB] })],
      middleware: [mwA, mwB],
      run: async () => "local-should-not-run",
    });

    const tunnel = resource({
      id: "tests.policy.tunnel2",
      tags: [globals.tags.tunnel.with({ mode: "client", tasks: [t] })],
      init: async () => ({
        run: async () => "remote", // remote handler
      }),
    });

    const app = resource({ id: "tests.policy.app2", register: [mwA, mwB, t, tunnel] });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(calledA).toBe(0);
    expect(calledB).toBe(1);
  });

  it("runs all middlewares by default (no tag) when tunneled", async () => {
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
      tags: [globals.tags.tunnel.with({ mode: "client", tasks: [t] })],
      init: async () => ({ run: async () => "remote" }),
    });

    const app = resource({ id: "tests.policy.app3", register: [mwA, mwB, t, tunnel] });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(calledA).toBe(1);
    expect(calledB).toBe(1);
  });

  it("does not filter when tag exists but client list is undefined (server-only policy)", async () => {
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
      // tag present but only server key set; client is undefined -> no filtering
      tags: [globals.tags.tunnelPolicy.with({ server: [mwA.id] })],
      middleware: [mwA, mwB],
      run: async () => "local-should-not-run",
    });

    const tunnel = resource({
      id: "tests.policy.tunnel5",
      tags: [globals.tags.tunnel.with({ mode: "client", tasks: [t] })],
      init: async () => ({ run: async () => "remote" }),
    });

    const app = resource({ id: "tests.policy.app5", register: [mwA, mwB, t, tunnel] });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(calledA).toBe(1);
    expect(calledB).toBe(1);
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
      tags: [globals.tags.tunnelPolicy.with({ client: [] })],
      middleware: [mwA, mwB],
      run: async () => "local-should-not-run",
    });

    const tunnel = resource({
      id: "tests.policy.tunnel4",
      tags: [globals.tags.tunnel.with({ mode: "client", tasks: [t] })],
      init: async () => ({ run: async () => "remote" }),
    });

    const app = resource({ id: "tests.policy.app4", register: [mwA, mwB, t, tunnel] });
    const rr = await run(app);
    const out = await rr.runTask(t.id, { v: 1 });

    expect(out).toBe("remote");
    expect(calledA).toBe(0);
    expect(calledB).toBe(0);
  });
});
