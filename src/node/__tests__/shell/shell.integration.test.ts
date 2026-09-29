import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Match, r, resources, run } from "../../node";
import { openShell, useInteractiveTerminal, describeUnix } from "./helpers";

useInteractiveTerminal();

describeUnix("resources.shell", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "rs-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function boot(name = "app", filename = "shell.sock") {
    const counter = r
      .resource("counter")
      .init(async () => ({ count: 0 }))
      .build();
    const increment = r
      .task("increment")
      .inputSchema({ amount: Match.Integer })
      .dependencies({ counter })
      .run(async ({ amount }, { counter }) => (counter.count += amount))
      .build();
    const socketPath = join(directory, filename);
    const runtime = await run(
      r
        .resource(name)
        .register([counter, increment, resources.shell.with({ socketPath })])
        .build(),
    );
    const client = openShell(socketPath);
    await client.waitFor("runner> ");
    return { runtime, client, counter, socketPath };
  }

  it("attaches to the live runtime with await, persistent bindings, console and error recovery", async () => {
    const { runtime, client, counter, socketPath } = await boot();
    expect(client.output()).toContain("Runner shell | app | pid");
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(
      await client.command("const value = await Promise.resolve(41)"),
    ).not.toContain("Uncaught");
    expect(await client.command("value + 1")).toContain("42");
    expect(
      await client.command(
        'await runtime.runTask("app.tasks.increment", { amount: 1 })',
      ),
    ).toContain("1");
    expect(runtime.getResourceValue(counter).count).toBe(1);
    expect(
      await client.command(
        'await runtime.runTask("app.tasks.increment", { amount: "invalid" })',
      ),
    ).toContain("matchError");
    expect(runtime.getResourceValue(counter).count).toBe(1);
    expect(
      await client.command(
        'const counter = runtime.getResourceValue("app.counter")',
      ),
    ).not.toContain("Uncaught");
    expect(await client.command("counter.count += 3")).toContain("4");
    expect(runtime.getResourceValue(counter).count).toBe(4);
    expect(
      await client.command('console.log("hello from the shell")'),
    ).toContain("hello from the shell");
    expect(
      await client.command('throw new Error("expected failure")'),
    ).toContain("Uncaught Error: expected failure");
    expect(
      await client.command('await Promise.reject(new Error("async failure"))'),
    ).toContain("async failure");
    expect(await client.command("2 + 3")).toContain("5");
    const closed = once(client.socket, "close");
    client.socket.write(".exit\n");
    await closed;
    expect(await runtime.runTask("app.tasks.increment", { amount: 1 })).toBe(5);
    await runtime.dispose();
    await expect(stat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("supports multiline input, arrow history, completion and restoring runtime after .clear", async () => {
    const { runtime, client } = await boot();
    await client.command("function answer() {\nreturn 42;\n}");
    expect(await client.command("answer()")).toContain("42");
    expect(await client.command("\x1b[A")).toContain("42");
    client.socket.write("runt");
    await client.waitFor("runt");
    client.socket.write("\t");
    await client.waitFor("runtime");
    expect(await client.command(".root.id")).toContain("'app'");
    await client.command(".clear");
    expect(await client.command("runtime.root.id")).toContain("'app'");
    expect(await client.command("typeof answer")).toContain("'undefined'");
    await runtime.dispose();
  });

  it("isolates session variables and containers while sharing each container's resource state", async () => {
    const first = await boot("first", "first.sock");
    const second = await boot("second", "second.sock");
    const sibling = openShell(first.socketPath);
    await sibling.waitFor("runner> ");
    await first.client.command("var sessionOnly = 123");
    expect(await sibling.command("typeof sessionOnly")).toContain(
      "'undefined'",
    );
    await first.client.command(
      'await runtime.runTask("first.tasks.increment", { amount: 1 })',
    );
    expect(
      await sibling.command('runtime.getResourceValue("first.counter").count'),
    ).toContain("1");
    expect(second.runtime.getResourceValue(second.counter).count).toBe(0);
    expect(await second.client.command("runtime.root.id")).toContain(
      "'second'",
    );
    const disconnected = once(sibling.socket, "close");
    await first.runtime.dispose();
    await disconnected;
    expect(await second.client.command("1 + 1")).toContain("2");
    await second.runtime.dispose();
  });

  it("uses application constructors for common schema-validated values", async () => {
    const inspect = r
      .task("inspect")
      .inputSchema({ date: Date, map: Map, set: Set, regex: RegExp })
      .run(async ({ date, map, set, regex }) => [
        date.getUTCFullYear(),
        map.get("key"),
        set.has("value"),
        regex.test("shell"),
      ])
      .build();
    const socketPath = join(directory, "values.sock");
    const runtime = await run(
      r
        .resource("app")
        .register([inspect, resources.shell.with({ socketPath })])
        .build(),
    );
    const client = openShell(socketPath);
    await client.waitFor("runner> ");
    const code =
      'await runtime.runTask("app.tasks.inspect", { date: new Date("2026-01-01"), map: new Map([["key", 42]]), set: new Set(["value"]), regex: new RegExp("shell") })';
    expect(await client.command(code)).toContain("[ 2026, 42, true, true ]");
    await client.command(".clear");
    expect(await client.command(code)).toContain("[ 2026, 42, true, true ]");
    await runtime.dispose();
  });

  it("disconnects sessions during shutdown and tolerates a client that disappears", async () => {
    const { runtime, client } = await boot();
    client.socket.destroy();
    const another = openShell(join(directory, "shell.sock"));
    await another.waitFor("runner> ");
    const closed = once(another.socket, "close");
    await runtime.dispose();
    await closed;
    await runtime.dispose();
  });
});
