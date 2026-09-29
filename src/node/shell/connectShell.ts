import { createConnection } from "node:net";
import { shellError } from "./errors";
import { assertSocketPath } from "./socketPath";
import type { ConnectShellOptions } from "./types";

/**
 * Attaches a terminal to an existing runtime shell until it disconnects.
 * Restores terminal mode on exit or failure. Use SSH with `-t` for remote access.
 */
export async function connectShell({
  socketPath,
  input = process.stdin,
  output = process.stdout,
}: ConnectShellOptions): Promise<void> {
  assertSocketPath(socketPath);
  if (!input.isTTY || !output.isTTY) {
    throw shellError.new({
      message:
        "The shell connector requires a terminal. When using SSH, pass -t.",
    });
  }

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const wasRaw = input.isRaw ?? false;
    const wasPaused = input.isPaused();
    let attached = false;
    let failure: Error | undefined;
    const disconnect = () => socket.destroy();
    const fail = (error: Error) => {
      failure = error;
      socket.destroy();
    };
    socket.on("error", fail);
    socket.once("connect", () => {
      try {
        input.setRawMode(true);
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : shellError.new({ message: String(error) }),
        );
        return;
      }
      attached = true;
      input.on("end", disconnect);
      input.on("error", fail);
      output.on("error", fail);
      input.pipe(socket);
      socket.pipe(output, { end: false });
    });
    socket.once("close", () => {
      if (attached) {
        input.unpipe(socket);
        socket.unpipe(output);
        input.removeListener("end", disconnect);
        input.removeListener("error", fail);
        output.removeListener("error", fail);
        try {
          input.setRawMode(wasRaw);
        } catch (error) {
          failure ??=
            error instanceof Error
              ? error
              : shellError.new({ message: String(error) });
        }
        if (wasPaused) input.pause();
      }
      if (failure) reject(failure);
      else resolve();
    });
  });
}
