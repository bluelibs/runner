import * as net from "node:net";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPrivateSocketDirectory,
  assertSocketPath,
} from "../../shell/socketPath";
import { ShellServer } from "../../shell/ShellServer";
import { r, run, resources } from "../../node";
import { describeUnix } from "./helpers";

describeUnix("shell socket ownership", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "rs-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["relative.sock", "/tmp/a\0b", `/${"a".repeat(103)}`])(
    "rejects invalid address %j",
    (path) => {
      expect(() => assertSocketPath(path)).toThrow("absolute Unix path");
    },
  );

  it("rejects unsupported platforms before attempting filesystem operations", () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(() => assertSocketPath("/shell.sock")).toThrow("Unix sockets");
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });

  it("requires a private, existing directory owned by the process user", async () => {
    await expect(
      assertPrivateSocketDirectory(join(directory, "shell.sock")),
    ).resolves.toBeUndefined();
    await chmod(directory, 0o755);
    await expect(
      assertPrivateSocketDirectory(join(directory, "shell.sock")),
    ).rejects.toThrow("0700");
    await chmod(directory, 0o700);
    const getuid = jest
      .spyOn(process, "getuid")
      .mockReturnValue(process.getuid!() + 1);
    try {
      await expect(
        assertPrivateSocketDirectory(join(directory, "shell.sock")),
      ).rejects.toThrow("owned by the current user");
    } finally {
      getuid.mockRestore();
    }
    await expect(
      assertPrivateSocketDirectory(join(directory, "missing", "shell.sock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlink or regular file as the socket directory", async () => {
    const target = join(directory, "target");
    await mkdir(target, { mode: 0o700 });
    const link = join(directory, "link");
    await symlink(target, link);
    await expect(
      assertPrivateSocketDirectory(join(link, "shell.sock")),
    ).rejects.toThrow("not be a symlink");
    const file = join(directory, "file");
    await writeFile(file, "keep me");
    await expect(
      assertPrivateSocketDirectory(join(file, "shell.sock")),
    ).rejects.toThrow("not be a symlink");
  });

  it("never takes over another listener's address", async () => {
    const runtime = await run(r.resource("app").build());
    const socketPath = join(directory, "shell.sock");
    const first = new ShellServer(socketPath, runtime);
    const second = new ShellServer(socketPath, runtime);
    await first.listen();
    try {
      await expect(second.listen()).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
      await second.close();
    } finally {
      await first.close();
    }
    await first.close();
    await runtime.dispose();
  });

  it("closes a session when its transport reports an error", async () => {
    const runtime = await run(r.resource("app").build());
    const createServer = jest.spyOn(net, "createServer");
    const shell = new ShellServer(join(directory, "shell.sock"), runtime);
    const server: net.Server = createServer.mock.results[0].value;
    createServer.mockRestore();
    server.once("connection", (socket) => {
      socket.emit("error", new Error("transport failed"));
    });
    await shell.listen();
    const client = net.createConnection(shell.socketPath);
    client.resume();
    await once(client, "close");
    expect(client.destroyed).toBe(true);
    await shell.close();
    await runtime.dispose();
  });

  it("rejects invalid resource configuration and rolls back failed startup", async () => {
    expect(() => resources.shell.with({ socketPath: "" })).toThrow(
      "non-empty string",
    );
    await expect(
      run(
        r
          .resource("app")
          .register([resources.shell.with({ socketPath: "relative.sock" })])
          .build(),
      ),
    ).rejects.toThrow("absolute Unix path");
  });
});
