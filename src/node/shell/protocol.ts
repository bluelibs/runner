import type { Socket } from "node:net";
import { Match } from "../../tools/check";
import { shellError } from "./errors";
import { readProtocolLine } from "./protocolLine";

const greeting = { protocol: "runner-shell", version: 1 } as const;
const greetingSchema = Match.compile(Match.ObjectStrict(greeting));
const accessSchema = Match.compile(Match.ObjectStrict({ readOnly: Boolean }));

export async function acceptShellConnection(
  socket: Socket,
  requireReadOnly: boolean,
): Promise<boolean> {
  socket.write(`${JSON.stringify(greeting)}\n`);
  const request = accessSchema.parse(
    JSON.parse(await readProtocolLine(socket)),
  );
  const readOnly = requireReadOnly || request.readOnly;
  socket.write(`${JSON.stringify({ readOnly })}\n`);
  return readOnly;
}

export async function negotiateShellConnection(
  socket: Socket,
  readOnly: boolean,
): Promise<void> {
  // Wait for a versioned greeting before sending anything an old REPL could evaluate.
  greetingSchema.parse(JSON.parse(await readProtocolLine(socket)));
  socket.write(`${JSON.stringify({ readOnly })}\n`);
  const accepted = accessSchema.parse(
    JSON.parse(await readProtocolLine(socket)),
  );
  if (readOnly && !accepted.readOnly) {
    throw shellError.new({
      message: "The server did not accept the requested read-only shell mode.",
    });
  }
}
