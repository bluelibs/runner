import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { shellError } from "./errors";

/** Resolves the default at startup, rather than when the module is imported. */
export function defaultShellSocketPath(): string {
  return join(process.cwd(), "runner.sock");
}

export function assertSocketPath(socketPath: string): void {
  if (process.platform === "win32") {
    throw shellError.new({
      message: "The runtime shell requires Unix sockets.",
    });
  }
  // Keep paths portable across Unix variants rather than allowing silent truncation.
  if (
    !isAbsolute(socketPath) ||
    socketPath.includes("\0") ||
    Buffer.byteLength(socketPath) > 103
  ) {
    throw shellError.new({
      message:
        "Shell socketPath must be an absolute Unix path of at most 103 bytes without NUL characters.",
    });
  }
}

export async function assertPrivateSocketDirectory(
  socketPath: string,
): Promise<void> {
  assertSocketPath(socketPath);
  const directory = dirname(socketPath);
  const stats = await lstat(directory);
  if (
    !stats.isDirectory() ||
    stats.uid !== process.getuid!() ||
    (stats.mode & 0o077) !== 0
  ) {
    throw shellError.new({
      message: `Shell socket directory '${directory}' must be owned by the current user, have mode 0700, and not be a symlink.`,
    });
  }
}
