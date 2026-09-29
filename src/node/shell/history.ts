import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { check } from "../../tools/check";
import { shellError } from "./errors";

export async function openShellHistory(path: string) {
  if (!isAbsolute(path) || path.includes("\0"))
    throw shellError.new({
      message:
        "Shell historyFile must be an absolute path without NUL characters.",
    });
  const directory = await lstat(dirname(path));
  if (
    !directory.isDirectory() ||
    directory.uid !== process.getuid!() ||
    (directory.mode & 0o077) !== 0
  ) {
    throw shellError.new({
      message:
        "Shell history requires an owner-only directory, without a symlink as its immediate parent.",
    });
  }
  const file = await open(
    path,
    constants.O_RDWR |
      constants.O_CREAT |
      constants.O_APPEND |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const stats = await file.stat();
    if (
      !stats.isFile() ||
      stats.uid !== process.getuid!() ||
      (stats.mode & 0o077) !== 0
    )
      throw shellError.new({
        message:
          "Shell history must be a regular, owner-only file owned by the app user.",
      });
    const content = await file.readFile("utf8");
    const lines = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const value: unknown = JSON.parse(line);
        check(value, String);
        return value;
      })
      .slice(-1000)
      .reverse();
    let pending = Promise.resolve();
    let closing: Promise<void> | undefined;
    return {
      lines: [...new Set(lines)],
      append(line: string) {
        // Leading spaces let operators deliberately keep a command out of history.
        if (!line.trim() || line.startsWith(" ") || line === ".exit")
          return pending;
        pending = pending.then(() =>
          file.appendFile(`${JSON.stringify(line)}\n`, "utf8"),
        );
        return pending;
      },
      close() {
        return (closing ??= pending.finally(() => file.close()));
      },
    };
  } catch (error) {
    await file.close();
    throw error;
  }
}
