import * as net from "node:net";
import { once } from "node:events";
import { negotiateShellConnection } from "../../shell/protocol";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { r, resources, run, runShell } from "../../node";
import { describeUnix } from "./helpers";

describeUnix("runShell", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "run-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function boot(readOnly = false) {
    const denied = r
      .error("writeDenied")
      .format(() => "Read-only shell")
      .build();
    const counter = r
      .resource("counter")
      .dependencies({ shell: resources.shell })
      .init(async (_, { shell }) => {
        let value = 0;
        return {
          mode: () => shell.isReadOnly(),
          wait: async () => 42,
          increment() {
            if (shell.isReadOnly()) throw denied.new();
            return ++value;
          },
        };
      })
      .build();
    const socketPath = join(directory, "shell.sock");
    const runtime = await run(
      r
        .resource("app")
        .register([counter, resources.shell.with({ socketPath, readOnly })])
        .build(),
    );
    return { runtime, socketPath, counter };
  }

  it("captures console output and the awaited value without a terminal or prompts", async () => {
    const { runtime, socketPath } = await boot();
    try {
      expect(
        await runShell({
          socketPath,
          command:
            'console.log("hello"); console.error("diagnostic"); await Promise.resolve(42)',
        }),
      ).toEqual({ success: true, output: "hello\ndiagnostic\n42\n" });
      expect(
        await runShell({
          socketPath,
          command: "const answer = await Promise.resolve(42);\nanswer",
        }),
      ).toEqual({ success: true, output: "42\n" });
      expect(
        await runShell({ socketPath, command: 'console.log("done")' }),
      ).toEqual({ success: true, output: "done\n" });
      expect(
        await runShell({ socketPath, command: "({ value: 42 })" }),
      ).toEqual({ success: true, output: "{ value: 42 }\n" });
    } finally {
      await runtime.dispose();
    }
  });

  it.each([
    ['throw new Error("expected failure")', "expected failure"],
    ['await Promise.reject(new Error("rejected await"))', "rejected await"],
    ['throw "text failure"', "text failure"],
    ["const incomplete =", "SyntaxError"],
    ["const = nope", "SyntaxError"],
  ])(
    "returns failure for %s without taking down the app",
    async (command, expected) => {
      const { runtime, socketPath } = await boot();
      try {
        const result = await runShell({ socketPath, command });
        expect(result.success).toBe(false);
        expect(result.output).toContain(expected);
        expect(
          await runShell({ socketPath, command: "runtime.root.id" }),
        ).toEqual({ success: true, output: "'app'\n" });
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("preserves read-only scope across await and keeps later commands and ordinary work writable", async () => {
    const { runtime, socketPath, counter } = await boot();
    try {
      const command =
        'await Promise.resolve(); runtime.getResourceValue("app.counter").increment()';
      expect(
        await runShell({ socketPath, command, readOnly: true }),
      ).toMatchObject({
        success: false,
        output: expect.stringContaining("Read-only shell"),
      });
      expect(runtime.getResourceValue(counter).mode()).toBe(false);
      expect(await runShell({ socketPath, command })).toEqual({
        success: true,
        output: "1\n",
      });
      expect(
        await runShell({ socketPath, command: "var sessionValue = 123" }),
      ).toEqual({ success: true, output: "" });
      expect(
        await runShell({ socketPath, command: "typeof sessionValue" }),
      ).toEqual({ success: true, output: "'undefined'\n" });
    } finally {
      await runtime.dispose();
    }
  });

  it("honors a server read-only requirement", async () => {
    const { runtime, socketPath } = await boot(true);
    try {
      expect(
        await runShell({
          socketPath,
          command: 'runtime.getResourceValue("app.counter").mode()',
        }),
      ).toEqual({ success: true, output: "true\n" });
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects oversized requests locally and permits long commands within the protocol bound", async () => {
    const { runtime, socketPath } = await boot();
    try {
      await expect(
        runShell({ socketPath, command: "a".repeat(64 * 1024) }),
      ).rejects.toThrow("exceeds 64 KiB");
      expect(
        await runShell({ socketPath, command: `/*${"a".repeat(2000)}*/ 42` }),
      ).toEqual({ success: true, output: "42\n" });
    } finally {
      await runtime.dispose();
    }
  });

  it("tolerates a disconnect while evaluation is awaiting, including late console output", async () => {
    const factory = jest.spyOn(net, "createServer");
    const { runtime, socketPath, counter } = await boot();
    const server: net.Server = factory.mock.results[0].value;
    factory.mockRestore();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    runtime.getResourceValue(counter).wait = async () => {
      entered();
      await gate;
      return 42;
    };
    try {
      const connection = once(server, "connection");
      const socket = net.createConnection(socketPath);
      await once(socket, "connect");
      const [peer] = await connection;
      await negotiateShellConnection(
        socket,
        false,
        'await runtime.getResourceValue("app.counter").wait(); console.log("late output"); 42',
      );
      await started;
      const closed = once(peer, "close");
      socket.destroy();
      await closed;
      release();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await runShell({ socketPath, command: "42" })).toEqual({
        success: true,
        output: "42\n",
      });
    } finally {
      release();
      await runtime.dispose();
    }
  });

  it("rejects empty commands and missing sockets", async () => {
    const socketPath = join(directory, "missing.sock");
    await expect(runShell({ socketPath, command: "" })).rejects.toThrow();
    await expect(runShell({ socketPath, command: "42" })).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });
});
