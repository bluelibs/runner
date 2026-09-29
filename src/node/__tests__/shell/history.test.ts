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
import { openShellHistory } from "../../shell/history";
import { describeUnix } from "./helpers";

describeUnix("private shell history", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "hist-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("appends independently across sessions and restores newest distinct commands", async () => {
    const path = join(directory, "history");
    const first = await openShellHistory(path);
    const second = await openShellHistory(path);
    await Promise.all([first.append("first"), second.append("second")]);
    await first.append("first");
    await first.append(" ");
    await first.append(" secret");
    await first.append(".exit");
    await first.close();
    await first.close();
    await second.close();
    const next = await openShellHistory(path);
    expect(next.lines).toEqual(["first", "second"]);
    await next.close();
  });
  it.each(["relative", "a\0b"])(
    "rejects an invalid history path %j",
    async (path) => {
      await expect(openShellHistory(path)).rejects.toThrow("absolute path");
    },
  );
  it("rejects shared directories and history files without changing their permissions", async () => {
    const path = join(directory, "history");
    await chmod(directory, 0o755);
    await expect(openShellHistory(path)).rejects.toThrow(
      "owner-only directory",
    );
    await chmod(directory, 0o700);
    await writeFile(path, '"private"\n', { mode: 0o644 });
    await expect(openShellHistory(path)).rejects.toThrow("owner-only file");
    expect(await readFile(path, "utf8")).toBe('"private"\n');
  });
  it("rejects symlinked paths, wrong owners, and malformed history", async () => {
    const path = join(directory, "history");
    const target = join(directory, "target");
    await writeFile(target, "{}\n", { mode: 0o600 });
    await symlink(target, path);
    await expect(openShellHistory(path)).rejects.toMatchObject({
      code: "ELOOP",
    });
    await expect(openShellHistory(target)).rejects.toThrow();
    const uid = jest
      .spyOn(process, "getuid")
      .mockReturnValue(process.getuid!() + 1);
    try {
      await expect(openShellHistory(target)).rejects.toThrow(
        "owner-only directory",
      );
    } finally {
      uid.mockRestore();
    }
    const link = join(directory, "link");
    await symlink(directory, link);
    await expect(openShellHistory(join(link, "history"))).rejects.toThrow(
      "owner-only directory",
    );
  });
});
