import type { Socket } from "node:net";
import { shellError } from "./errors";

const MAX_HANDSHAKE_BYTES = 1024;
const HANDSHAKE_TIMEOUT_MS = 5000;

/** Reads one bounded handshake line, leaving subsequent terminal bytes untouched. */
export function readProtocolLine(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) {
      reject(
        shellError.new({
          message: "Shell connection closed during handshake.",
        }),
      );
      return;
    }
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.pause();
      socket.removeListener("data", onData);
      socket.removeListener("error", fail);
      socket.removeListener("end", closed);
      socket.removeListener("close", closed);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const closed = () =>
      fail(
        shellError.new({
          message: "Shell connection closed during handshake.",
        }),
      );
    const onData = (chunk: Buffer) => {
      const newline = chunk.indexOf(10);
      const length = newline < 0 ? chunk.length : newline;
      if (buffer.length + length > MAX_HANDSHAKE_BYTES) {
        fail(
          shellError.new({ message: "Shell handshake exceeds 1024 bytes." }),
        );
        return;
      }
      buffer = Buffer.concat([buffer, chunk.subarray(0, length)]);
      if (newline < 0) return;
      cleanup();
      if (newline + 1 < chunk.length)
        socket.unshift(chunk.subarray(newline + 1));
      resolve(buffer.toString("utf8"));
    };
    const timeout = setTimeout(
      () => fail(shellError.new({ message: "Shell handshake timed out." })),
      HANDSHAKE_TIMEOUT_MS,
    );
    socket.on("data", onData);
    socket.once("error", fail);
    socket.once("end", closed);
    socket.once("close", closed);
    socket.resume();
  });
}
