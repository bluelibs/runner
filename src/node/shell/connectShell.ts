import { once } from "node:events";
import { createConnection } from "node:net";
import { check } from "../../tools/check";
import { shellError } from "./errors";
import { negotiateShellConnection } from "./protocol";
import { assertSocketPath } from "./socketPath";
import { attachShellTerminal } from "./terminal";
import type { ConnectShellOptions } from "./types";

/**
 * Attaches a terminal to an existing runtime shell until it disconnects.
 * Negotiates read-only access before forwarding input. Use SSH with `-t` remotely.
 */
export async function connectShell({
  socketPath,
  readOnly = false,
  input = process.stdin,
  output = process.stdout,
}: ConnectShellOptions): Promise<void> {
  assertSocketPath(socketPath);
  check(readOnly, Boolean);
  if (!input.isTTY || !output.isTTY) {
    throw shellError.new({
      message:
        "The shell connector requires a terminal. When using SSH, pass -t.",
    });
  }
  const socket = createConnection(socketPath);
  try {
    await once(socket, "connect");
    await negotiateShellConnection(socket, readOnly);
    await attachShellTerminal(socket, input, output);
  } finally {
    socket.destroy();
  }
}
