import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { runInThisContext } from "node:vm";
import { r, resources, run } from "../../node";
import { openShell, describeUnix } from "./helpers";

const nativeProcess: NodeJS.Process = runInThisContext("process");
describeUnix("shell quality of life", () => {
  let directory: string;
  let previousTerm: string | undefined;
  let previousLocalTerm: string | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "qol-"));
    previousTerm = nativeProcess.env.TERM;
    previousLocalTerm = process.env.TERM;
    process.env.TERM = "dumb";
    nativeProcess.env.TERM = "dumb";
  });
  afterEach(async () => {
    if (previousTerm === undefined) delete nativeProcess.env.TERM;
    else nativeProcess.env.TERM = previousTerm;
    if (previousLocalTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousLocalTerm;
    await rm(directory, { recursive: true, force: true });
  });
  async function boot() {
    const counter = r
      .resource("counter")
      .meta({ title: "Counter", description: "Stores the live count" })
      .init(async () => ({ value: 0 }))
      .build();
    const answer = r
      .task("answer")
      .meta({ description: "Returns the answer" })
      .run(async () => 42)
      .build();
    const socketPath = join(directory, "shell.sock");
    const runtime = await run(
      r
        .resource("app")
        .register([counter, answer, resources.shell.with({ socketPath })])
        .build(),
    );
    return { runtime, socketPath };
  }
  it("supports history and completion with a dumb service TERM without changing the environment", async () => {
    const { runtime, socketPath } = await boot();
    try {
      const client = openShell(socketPath, false, { terminal: true });
      await client.waitFor("runner> ");
      expect(await client.command("await Promise.resolve(42)")).toContain("42");
      expect(await client.command("\x1b[A")).toContain("42");
      client.socket.write("runt");
      await client.waitFor("runt");
      client.socket.write("\t");
      await client.waitFor("runtime");
      expect(await client.command(".root.id")).toContain("'app'");
      expect(nativeProcess.env.TERM).toBe("dumb");
    } finally {
      await runtime.dispose();
    }
  });
  it("lists canonical IDs and descriptions, filters discovery, and reports session status", async () => {
    const { runtime, socketPath } = await boot();
    try {
      const client = openShell(socketPath, true, { terminal: true });
      await client.waitFor("runner[read-only]> ");
      expect(await client.command(".tasks answer")).toContain(
        "app.tasks.answer — Returns the answer",
      );
      expect(await client.command(".resources counter")).toContain(
        "app.counter — Counter — Stores the live count",
      );
      expect(await client.command(".tasks nonexistent")).toContain(
        "No matching definitions.",
      );
      expect(await client.command(".status")).toContain(
        "Access: read-only\nTerminal: interactive\nHistory: memory only",
      );
      await client.command(".clear");
      expect(await client.command(".status")).toContain(
        `Process: ${process.pid}`,
      );
    } finally {
      await runtime.dispose();
    }
  });
  it("persists history only when requested, restores it on reconnect, and skips leading-space commands", async () => {
    const { runtime, socketPath } = await boot();
    const historyFile = join(directory, "history.jsonl");
    try {
      const client = openShell(socketPath, false, {
        terminal: true,
        historyFile,
      });
      await client.waitFor("runner> ");
      expect(await client.command("21 * 2")).toContain("42");
      await client.command(" console.log('private command')");
      const closed = once(client.socket, "close");
      client.socket.write(".exit\n");
      await closed;
      expect(await readFile(historyFile, "utf8")).toBe('"21 * 2"\n');
      expect((await stat(historyFile)).mode & 0o777).toBe(0o600);
      const next = openShell(socketPath, false, {
        terminal: true,
        historyFile,
      });
      await next.waitFor("runner> ");
      expect(await next.command("\x1b[A")).toContain("42");
      expect(await next.command(".status")).toContain(historyFile);
    } finally {
      await runtime.dispose();
    }
  });
  it("allows a basic terminal independently of the service environment", async () => {
    nativeProcess.env.TERM = "xterm";
    process.env.TERM = "xterm";
    const { runtime, socketPath } = await boot();
    try {
      const client = openShell(socketPath, false, { terminal: false });
      await client.waitFor("runner> ");
      expect(await client.command(".status")).toContain("Terminal: basic");
      expect(await client.command("await Promise.resolve(42)")).toContain("42");
    } finally {
      await runtime.dispose();
    }
  });
});
