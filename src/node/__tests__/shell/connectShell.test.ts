import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { connectShell, r, resources, run } from "../../node";
import { useInteractiveTerminal, describeUnix } from "./helpers";

class Terminal extends PassThrough {
  isTTY = true;
  isRaw: boolean | undefined = false;
  setRawMode = jest.fn((mode: boolean) => {
    this.isRaw = mode;
    return this;
  });
}

function readUntil(output: Terminal, text: string): Promise<void> {
  return new Promise((resolve) => {
    let content = "";
    const onData = (chunk: Buffer) => {
      content += chunk.toString();
      if (content.includes(text)) {
        output.removeListener("data", onData);
        resolve();
      }
    };
    output.on("data", onData);
  });
}

useInteractiveTerminal();

describeUnix("connectShell", () => {
  let directory: string;
  let input: Terminal;
  let output: Terminal;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "rc-"));
    input = new Terminal();
    output = new Terminal();
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
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

  it("forwards terminal editing and await, restores raw mode, and leaves the app running", async () => {
    const { runtime, socketPath } = await boot();
    input.pause();
    const ready = readUntil(output, "runner> ");
    const connected = connectShell({ socketPath, input, output });
    await ready;
    expect(input.isRaw).toBe(true);
    const result = readUntil(output, "42");
    input.write("await Promise.resolve(6 * 7)\n");
    await result;
    const history = readUntil(output, "42");
    input.write("\x1b[A\n");
    await history;
    input.write(".exit\n");
    await connected;
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.isPaused()).toBe(true);
    expect(output.writableEnded).toBe(false);
    expect(input.listenerCount("error")).toBe(0);
    expect(output.listenerCount("error")).toBe(0);
    expect(runtime.root.id).toBe("app");
    await runtime.dispose();
  });

  it("preserves an already-raw terminal and handles remote shutdown", async () => {
    const { runtime, socketPath } = await boot();
    input.isRaw = true;
    input.resume();
    const ready = readUntil(output, "runner> ");
    const connected = connectShell({ socketPath, input, output });
    await ready;
    await runtime.dispose();
    await connected;
    expect(input.isRaw).toBe(true);
    expect(input.readableFlowing).toBe(true);
  });

  it("does not drain previously unread input after disconnecting", async () => {
    const { runtime, socketPath } = await boot();
    expect(input.readableFlowing).toBeNull();
    try {
      const ready = readUntil(output, "runner> ");
      const connected = connectShell({ socketPath, input, output });
      await ready;
      input.write(".exit\n");
      await connected;
      input.write("next consumer's input");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(input.readableFlowing).not.toBe(true);
      expect(input.read().toString()).toBe("next consumer's input");
    } finally {
      await runtime.dispose();
    }
  });

  it.each(["interactive", "basic"] as const)(
    "honors the %s terminal override",
    async (terminal) => {
      const { runtime, socketPath } = await boot();
      const ready = readUntil(output, "runner> ");
      const connected = connectShell({ socketPath, input, output, terminal });
      await ready;
      const status = readUntil(output, `Terminal: ${terminal}`);
      input.write(".status\n");
      await status;
      input.write(".exit\n");
      await connected;
      await runtime.dispose();
    },
  );

  it("disconnects on terminal EOF", async () => {
    const { runtime, socketPath } = await boot();
    input.isRaw = undefined;
    const ready = readUntil(output, "runner> ");
    const connected = connectShell({ socketPath, input, output });
    await ready;
    input.end();
    await connected;
    expect(input.isRaw).toBe(false);
    await runtime.dispose();
  });

  it.each(["input", "output"] as const)(
    "cleans up after %s fails",
    async (target) => {
      const { runtime, socketPath } = await boot();
      const ready = readUntil(output, "runner> ");
      const connected = connectShell({ socketPath, input, output });
      const outcome = connected.then(
        () => undefined,
        (error: unknown) => error,
      );
      await ready;
      (target === "input" ? input : output).emit(
        "error",
        new Error("terminal failed"),
      );
      expect(await outcome).toEqual(
        expect.objectContaining({ message: "terminal failed" }),
      );
      expect(input.isRaw).toBe(false);
      await runtime.dispose();
    },
  );

  it("does not change terminal mode when connection fails", async () => {
    await expect(
      connectShell({
        socketPath: join(directory, "missing.sock"),
        input,
        output,
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(input.setRawMode).not.toHaveBeenCalled();
  });

  it.each(["input", "output"] as const)(
    "rejects a non-terminal %s",
    async (target) => {
      (target === "input" ? input : output).isTTY = false;
      await expect(
        connectShell({
          socketPath: join(directory, "shell.sock"),
          input,
          output,
        }),
      ).rejects.toThrow("pass -t");
    },
  );

  it.each([new Error("raw mode failed"), "raw mode failed"])(
    "rejects when raw mode cannot be enabled: %s",
    async (error) => {
      const { runtime, socketPath } = await boot();
      input.setRawMode.mockImplementation(() => {
        throw error;
      });
      await expect(connectShell({ socketPath, input, output })).rejects.toThrow(
        "raw mode failed",
      );
      await runtime.dispose();
    },
  );

  it.each([new Error("restore failed"), "restore failed"])(
    "reports a failure restoring the terminal: %s",
    async (error) => {
      const { runtime, socketPath } = await boot();
      const ready = readUntil(output, "runner> ");
      const connected = connectShell({ socketPath, input, output });
      const outcome = connected.then(
        () => undefined,
        (error: unknown) => error,
      );
      await ready;
      input.setRawMode.mockImplementation(() => {
        throw error;
      });
      input.write(".exit\n");
      expect(await outcome).toEqual(
        expect.objectContaining({ message: "restore failed" }),
      );
      await runtime.dispose();
    },
  );

  it("defaults to the process terminal streams", async () => {
    const { runtime, socketPath } = await boot();
    const stdin = jest
      .spyOn(process, "stdin", "get")
      .mockReturnValue(input as unknown as typeof process.stdin);
    const stdout = jest
      .spyOn(process, "stdout", "get")
      .mockReturnValue(output as unknown as typeof process.stdout);
    try {
      const ready = readUntil(output, "runner> ");
      const connected = connectShell({ socketPath });
      await ready;
      input.write(".exit\n");
      await connected;
    } finally {
      stdin.mockRestore();
      stdout.mockRestore();
      await runtime.dispose();
    }
  });
});
