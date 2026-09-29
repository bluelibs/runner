import { MAX_COMMAND_RESPONSE_BYTES } from "./commandOutput";
import { shellError } from "./errors";
import { once } from "node:events";
import { createConnection } from "node:net";
import { check, Match } from "../../tools/check";
import { negotiateShellConnection } from "./protocol";
import { assertSocketPath, defaultShellSocketPath } from "./socketPath";
import type { RunShellOptions, ShellCommandResult } from "./types";

const resultSchema = Match.compile(
  Match.ObjectStrict({ success: Boolean, output: String }),
);

/** Evaluates one JavaScript command in the live app without a terminal, then disconnects. */
export async function runShell({
  socketPath = defaultShellSocketPath(),
  command,
  readOnly = false,
}: RunShellOptions): Promise<ShellCommandResult> {
  assertSocketPath(socketPath);
  check(command, Match.NonEmptyString);
  check(readOnly, Boolean);
  const socket = createConnection(socketPath);
  try {
    await once(socket, "connect");
    await negotiateShellConnection(socket, readOnly, command);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of socket) {
      bytes += chunk.length;
      if (bytes > MAX_COMMAND_RESPONSE_BYTES) {
        throw shellError.new({
          message: "Shell command response exceeds its size limit.",
        });
      }
      chunks.push(chunk);
    }
    return resultSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
  } finally {
    socket.destroy();
  }
}
