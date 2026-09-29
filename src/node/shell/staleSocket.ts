import { lstat, mkdir, rmdir, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { shellError } from "./errors";

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function inspectSocket(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function assertDisconnected(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const finish = (error?: Error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.once("connect", () =>
      finish(
        shellError.new({
          message: `Shell socket '${path}' is already in use by a live listener.`,
        }),
      ),
    );
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") finish();
      else finish(error);
    });
    socket.setTimeout(1000, () =>
      finish(
        shellError.new({
          message: `Timed out checking shell socket '${path}'; it was not replaced.`,
        }),
      ),
    );
  });
}

/** Reclaims only an owned socket whose listener has gone away. */
export async function reclaimStaleSocket(
  path: string,
): Promise<() => Promise<void>> {
  const original = await inspectSocket(path);
  if (!original) return async () => {};
  if (!original.isSocket() || original.uid !== process.getuid!()) {
    throw shellError.new({
      message: `Shell socket '${path}' already exists and is not a socket owned by the current user; it was not replaced.`,
    });
  }
  // Serialize recovery across processes until the replacement has finished binding.
  // A crashed recovery leaves this marker for explicit operator inspection.
  const marker = `${path}.reclaim`;
  await mkdir(marker, { mode: 0o700 });
  const release = () => rmdir(marker);
  try {
    await assertDisconnected(path);
    const current = await inspectSocket(path);
    if (current) {
      if (current.dev !== original.dev || current.ino !== original.ino) {
        throw shellError.new({
          message: `Shell socket '${path}' changed during startup; it was not replaced.`,
        });
      }
      await unlink(path);
    }
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}
