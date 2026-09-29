import type { Socket } from "node:net";
import { shellError } from "./errors";
import type { ShellInput, ShellOutput } from "./types";

export function attachShellTerminal(
  socket: Socket,
  input: ShellInput,
  output: ShellOutput,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const wasRaw = input.isRaw ?? false;
    const wasPaused = input.isPaused();
    const wasFlowing = input.readableFlowing;
    let attached = false;
    let failure: Error | undefined;
    const disconnect = () => socket.destroy();
    const fail = (error: Error) => {
      failure = error;
      socket.destroy();
    };
    socket.on("error", fail);
    socket.once("close", () => {
      socket.removeListener("error", fail);
      if (attached) {
        input.unpipe(socket);
        socket.unpipe(output);
        input.removeListener("end", disconnect);
        input.removeListener("error", fail);
        output.removeListener("error", fail);
        try {
          input.setRawMode(wasRaw);
        } catch (error) {
          failure ??= terminalError(error);
        }
        if (wasPaused) input.pause();
        else if (wasFlowing === true) input.resume();
      }
      if (failure) reject(failure);
      else resolve();
    });
    try {
      input.setRawMode(true);
    } catch (error) {
      fail(terminalError(error));
      return;
    }
    attached = true;
    input.on("end", disconnect);
    input.on("error", fail);
    output.on("error", fail);
    input.pipe(socket);
    socket.pipe(output, { end: false });
  });
}

function terminalError(error: unknown): Error {
  return error instanceof Error
    ? error
    : shellError.new({ message: String(error) });
}
