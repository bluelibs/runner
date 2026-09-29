import { AsyncLocalStorage } from "node:async_hooks";
import { Socket } from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { r, resources, run } from "../../node";
import * as interactiveRepl from "../../shell/interactiveRepl";
import * as history from "../../shell/history";
import { startShellSession } from "../../shell/session";
import { openShell, describeUnix, useInteractiveTerminal } from "./helpers";

useInteractiveTerminal();
describeUnix("session setup and history failures", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "setup-"));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("closes loaded history after a disconnect or shutdown during setup", async () => {
    const runtime = await run(r.resource("app").build());
    const scope = new AsyncLocalStorage<boolean>();
    const socket = new Socket();
    socket.destroy();
    await startShellSession(socket, runtime, scope, false);
    const loaded = await history.openShellHistory(join(directory, "history"));
    const close = jest.spyOn(loaded, "close");
    jest.spyOn(history, "openShellHistory").mockResolvedValue(loaded);
    await startShellSession(socket, runtime, scope, false, true, "unused");
    expect(close).toHaveBeenCalledTimes(1);
    runtime.store.beginCoolingDown();
    const pending = new Socket();
    await startShellSession(pending, runtime, scope, false);
    expect(pending.destroyed).toBe(true);
    await runtime.dispose();
  });

  async function boot() {
    const socketPath = join(directory, "shell.sock");
    const runtime = await run(
      r
        .resource("app")
        .register([resources.shell.with({ socketPath })])
        .build(),
    );
    return { runtime, socketPath };
  }
  it("reports invalid history setup instead of leaving an unhandled rejection", async () => {
    const { runtime, socketPath } = await boot();
    try {
      const client = openShell(socketPath, false, { historyFile: "relative" });
      await client.waitFor("Shell setup failed:");
      expect(client.output()).toContain("absolute path");
      await once(client.socket, "close");
    } finally {
      await runtime.dispose();
    }
  });
  it("closes history when native session creation fails", async () => {
    const close = jest.fn(async () => {});
    jest
      .spyOn(history, "openShellHistory")
      .mockResolvedValue({ lines: [], append: async () => {}, close });
    jest
      .spyOn(interactiveRepl, "createInteractiveRepl")
      .mockImplementation(() => {
        throw new Error("unsupported terminal");
      });
    const { runtime, socketPath } = await boot();
    try {
      const client = openShell(socketPath, false, { historyFile: "mocked" });
      await client.waitFor("unsupported terminal");
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.dispose();
    }
  });

  it("disconnects safely when history writes and close fail", async () => {
    const failure = new Error("disk unavailable");
    jest.spyOn(history, "openShellHistory").mockResolvedValue({
      lines: [],
      append: async () => {
        throw failure;
      },
      close: async () => {
        throw failure;
      },
    });
    const { runtime, socketPath } = await boot();
    try {
      const client = openShell(socketPath, false, { historyFile: "mocked" });
      await client.waitFor("runner> ");
      const closed = once(client.socket, "close");
      client.socket.write("42\n");
      await closed;
    } finally {
      await runtime.dispose();
    }
  });
});
