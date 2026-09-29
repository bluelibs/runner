import type { Socket } from "node:net";
import { Match } from "../../tools/check";
import { shellError } from "./errors";
import { MAX_HANDSHAKE_BYTES, readProtocolLine } from "./protocolLine";

const greeting = { protocol: "runner-shell", version: 2 } as const;
const greetingSchema = Match.compile(Match.ObjectStrict(greeting));
const requestSchema = Match.compile(
  Match.ObjectStrict({
    readOnly: Boolean,
    run: Match.Optional(Match.NonEmptyString),
  }),
);
const accessSchema = Match.compile(Match.ObjectStrict({ readOnly: Boolean }));

export async function acceptShellConnection(
  socket: Socket,
  requireReadOnly: boolean,
): Promise<{ readOnly: boolean; run?: string }> {
  socket.write(`${JSON.stringify(greeting)}\n`);
  const request = requestSchema.parse(
    JSON.parse(await readProtocolLine(socket)),
  );
  const readOnly = requireReadOnly || request.readOnly;
  socket.write(`${JSON.stringify({ readOnly })}\n`);
  return { readOnly, run: request.run };
}

export async function negotiateShellConnection(
  socket: Socket,
  readOnly: boolean,
  command?: string,
): Promise<void> {
  // Wait for a versioned greeting before sending anything an old REPL could evaluate.
  greetingSchema.parse(JSON.parse(await readProtocolLine(socket)));
  const request = JSON.stringify({ readOnly, run: command });
  if (Buffer.byteLength(request) > MAX_HANDSHAKE_BYTES) {
    throw shellError.new({ message: "Shell handshake exceeds 64 KiB." });
  }
  socket.write(`${request}\n`);
  const accepted = accessSchema.parse(
    JSON.parse(await readProtocolLine(socket)),
  );
  if (readOnly && !accepted.readOnly) {
    throw shellError.new({
      message: "The server did not accept the requested read-only shell mode.",
    });
  }
}
