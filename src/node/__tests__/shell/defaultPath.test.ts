import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { connectShell, r, resources, run, runShell } from "../../node";
import { describeUnix } from "./helpers";

async function leaveStaleSocket(path: string) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      'require("net").createServer().listen(process.argv[1], () => process.stdout.write("ready"))',
      path,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await once(child.stdout, "data");
  } finally {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

describeUnix("default shell socket", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "default-"));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("registers without config and resolves the startup cwd for both connectors", async () => {
    const cwd = jest.spyOn(process, "cwd").mockReturnValue(directory);
    const runtime = await run(
      r.resource("app").register([resources.shell]).build(),
    );
    try {
      expect(runtime.getResourceValue(resources.shell).socketPath).toBe(
        join(directory, "runner.sock"),
      );
      expect(await runShell({ command: "42" })).toEqual({
        success: true,
        output: "42\n",
      });
      class Terminal extends PassThrough {
        isTTY = true;
        setRawMode() {}
      }
      const input = new Terminal();
      const output = new Terminal();
      let text = "";
      output.on("data", (chunk) => {
        text += chunk.toString();
        if (text.includes("runner> ")) input.end(".exit\n");
      });
      await connectShell({ input, output });
      expect(text).toContain("runner> ");
      await expect(connectShell()).rejects.toThrow("requires a terminal");
      cwd.mockReturnValue(join(directory, "elsewhere"));
      expect(runtime.getResourceValue(resources.shell).socketPath).toBe(
        join(directory, "runner.sock"),
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("reclaims an owned socket left by a crashed process", async () => {
    const socketPath = join(directory, "runner.sock");
    await leaveStaleSocket(socketPath);
    const runtime = await run(
      r
        .resource("app")
        .register([resources.shell.with({ socketPath })])
        .build(),
    );
    try {
      expect(await runShell({ socketPath, command: "42" })).toEqual({
        success: true,
        output: "42\n",
      });
    } finally {
      await runtime.dispose();
    }
  });

  it("preserves regular files and symlinks instead of replacing them", async () => {
    const socketPath = join(directory, "runner.sock");
    const target = join(directory, "target");
    await writeFile(socketPath, "keep me");
    const app = r
      .resource("app")
      .register([resources.shell.with({ socketPath })])
      .build();
    await expect(run(app)).rejects.toThrow("not a socket owned");
    expect(await readFile(socketPath, "utf8")).toBe("keep me");
    await rm(socketPath);
    await writeFile(target, "target");
    await symlink(target, socketPath);
    await expect(run(app)).rejects.toThrow("not a socket owned");
    expect(await readFile(target, "utf8")).toBe("target");
  });

  it("rejects startup if the directory cannot be written", async () => {
    await chmod(directory, 0o500);
    try {
      await expect(
        run(
          r
            .resource("app")
            .register([
              resources.shell.with({
                socketPath: join(directory, "runner.sock"),
              }),
            ])
            .build(),
        ),
      ).rejects.toThrow();
    } finally {
      await chmod(directory, 0o700);
    }
  });
});
