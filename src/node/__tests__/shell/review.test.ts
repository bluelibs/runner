import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";
import * as socketPaths from "../../shell/socketPath";
import { ShellServer } from "../../shell/ShellServer";
import { acceptShellConnection } from "../../shell/protocol";
import {
  MAX_COMMAND_OUTPUT_BYTES,
  MAX_COMMAND_RESPONSE_BYTES,
  createCommandOutput,
} from "../../shell/commandOutput";
import { commandWriter } from "../../shell/commandWriter";
import { r, resources, run, runShell } from "../../node";
import { describeUnix } from "./helpers";

describeUnix("shell review regressions", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "review-"));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it.each([false, true])(
    "waits for pending startup before closing (failure: %s)",
    async (fails) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      jest
        .spyOn(socketPaths, "assertPrivateSocketDirectory")
        .mockImplementation(async () => {
          await gate;
          if (fails) throw new Error("startup failed");
        });
      const runtime = await run(r.resource("app").build());
      const shell = new ShellServer(join(directory, "shell.sock"), runtime);
      const starting = Promise.allSettled([shell.listen(), shell.listen()]);
      let closed = false;
      const closing = shell.close().then(() => {
        closed = true;
      });
      try {
        await Promise.resolve();
        expect(closed).toBe(false);
        release();
        await starting;
        await closing;
        await shell.close();
        await expect(shell.listen()).rejects.toThrow("Cannot reopen");
        await expect(
          runShell({ socketPath: shell.socketPath, command: "42" }),
        ).rejects.toThrow();
      } finally {
        release();
        await starting;
        await shell.close();
        await runtime.dispose();
      }
    },
  );

  it("can close before startup", async () => {
    const runtime = await run(r.resource("app").build());
    const shell = new ShellServer(join(directory, "shell.sock"), runtime);
    await shell.close();
    await expect(shell.listen()).rejects.toThrow("Cannot reopen");
    await runtime.dispose();
  });

  it("caps captured bytes, keeps a prefix, and emits just one notice", () => {
    const output = createCommandOutput();
    output.write(Buffer.from("prefix"));
    output.write(Buffer.alloc(MAX_COMMAND_OUTPUT_BYTES, "x"));
    output.write(Buffer.from("discarded"));
    const text = output.read();
    expect(text.startsWith("prefix")).toBe(true);
    expect(text).not.toContain("discarded");
    expect(text.match(/truncated/g)).toHaveLength(1);
    expect(Buffer.byteLength(text)).toBeLessThan(
      MAX_COMMAND_OUTPUT_BYTES + 100,
    );
    output.clear();
    const exact = createCommandOutput();
    exact.write(Buffer.alloc(MAX_COMMAND_OUTPUT_BYTES));
    expect(exact.read()).not.toContain("truncated");
  });

  it("bounds console output and wide final values without running custom inspectors", async () => {
    const socketPath = join(directory, "shell.sock");
    const runtime = await run(
      r
        .resource("app")
        .register([resources.shell.with({ socketPath })])
        .build(),
    );
    try {
      const result = await runShell({
        socketPath,
        command:
          'for(let i = 0; i < 20; i++) console.log("x".repeat(100000)); 42',
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain("truncated");
      expect(Buffer.byteLength(result.output)).toBeLessThan(
        MAX_COMMAND_OUTPUT_BYTES + 100,
      );
      const wide = await runShell({
        socketPath,
        command:
          'Object.assign(Object.fromEntries(Array.from({ length: 10000 }, (_, i) => ["key" + i, "value"])), { [Symbol.for("nodejs.util.inspect.custom")]: () => { throw new Error("must not run") } })',
      });
      expect(wide.success).toBe(true);
      expect(wide.output).toContain("Preview limit");
      expect(wide.output.length).toBeLessThan(10000);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects a peer sending an oversized response", async () => {
    const socketPath = join(directory, "shell.sock");
    const server = createServer((socket) => {
      socket.on("error", () => socket.destroy());
      void acceptShellConnection(socket, false).then(() =>
        socket.end(Buffer.alloc(MAX_COMMAND_RESPONSE_BYTES + 1)),
      );
    });
    server.listen(socketPath);
    await once(server, "listening");
    try {
      await expect(runShell({ socketPath, command: "42" })).rejects.toThrow(
        "size limit",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("bounded command previews", () => {
  it("handles primitives, special objects, depth, cycles, and accessors", () => {
    expect(commandWriter("x".repeat(5000)).length).toBeLessThan(2100);
    expect(commandWriter(Symbol())).toContain("Symbol()");
    expect(commandWriter(Symbol("x".repeat(5000))).length).toBeLessThan(2200);
    expect(commandWriter(10n ** 200n)).toContain("Large BigInt");
    expect(commandWriter(-(10n ** 200n))).toContain("Large BigInt");
    expect(commandWriter(42n)).toBe("42n");
    expect(commandWriter(() => 42)).toContain("Function");
    expect(commandWriter(null)).toBe("null");
    expect(
      commandWriter(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error("trap");
            },
          },
        ),
      ),
    ).toContain("Proxy");
    const cyclic = { self: {} };
    cyclic.self = cyclic;
    expect(commandWriter(cyclic)).toContain("Circular");
    expect(commandWriter(new Error("oops"))).toContain("oops");
    expect(commandWriter(new Error())).toContain("No message");
    expect(commandWriter(new SyntaxError("syntax"))).toContain("SyntaxError");
    const anonymous = new Error("anonymous");
    Object.setPrototypeOf(anonymous, null);
    expect(commandWriter(anonymous)).toContain("Error: anonymous");
    const proxyError = new Error("proxy");
    Object.setPrototypeOf(proxyError, new Proxy({}, {}));
    expect(commandWriter(proxyError)).toContain("Error: proxy");
    const deepError = new Error("deep");
    Object.setPrototypeOf(deepError, {
      __proto__: { __proto__: { __proto__: {} } },
    });
    expect(commandWriter(deepError)).toContain("Error: deep");
    expect(commandWriter(new Date(0))).toContain("1970");
    expect(commandWriter(new Map([["key", 42]]))).toContain("key");
    expect(
      commandWriter(new Set(Array.from({ length: 200 }, (_, i) => i))),
    ).toContain("Preview limit");
    expect(
      commandWriter({
        get value() {
          throw new Error("getter");
        },
      }),
    ).toContain("Accessor");
    expect(commandWriter({ a: { a: { a: { a: { a: 1 } } } } })).toContain(
      "Preview limit",
    );
    expect(commandWriter(Object.create({ inherited: 1 }))).toBe("{}");
    expect(
      commandWriter(
        Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i, i])),
      ),
    ).toContain("Preview limit");
  });
});
