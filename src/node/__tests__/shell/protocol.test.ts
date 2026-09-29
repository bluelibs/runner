import { Socket } from "node:net";
import { readProtocolLine } from "../../shell/protocolLine";
import {
  acceptShellConnection,
  negotiateShellConnection,
} from "../../shell/protocol";

function transport() {
  const socket = new Socket();
  jest.spyOn(socket, "write").mockReturnValue(true);
  return socket;
}
const send = (socket: Socket, value: unknown) =>
  socket.emit("data", Buffer.from(`${JSON.stringify(value)}\n`));
const greeting = { protocol: "runner-shell", version: 3 };

it("reads fragmented lines and preserves following terminal bytes", async () => {
  const socket = transport();
  const line = readProtocolLine(socket);
  socket.emit("data", Buffer.from("hel"));
  socket.emit("data", Buffer.from("lo\nterminal"));
  expect(await line).toBe("hello");
  expect(socket.read().toString()).toBe("terminal");
  socket.destroy();
});

it.each(["end", "close"])(
  "rejects a handshake interrupted by %s",
  async (event) => {
    const socket = transport();
    const line = readProtocolLine(socket);
    socket.emit(event);
    await expect(line).rejects.toThrow("closed during handshake");
    expect(socket.listenerCount("data")).toBe(0);
    socket.destroy();
  },
);

it("rejects destroyed transports, oversized lines, errors, and timeouts", async () => {
  const closed = transport();
  closed.destroy();
  await expect(readProtocolLine(closed)).rejects.toThrow(
    "closed during handshake",
  );
  const oversized = transport();
  const line = readProtocolLine(oversized);
  oversized.emit("data", Buffer.alloc(64 * 1024 + 1, 65));
  await expect(line).rejects.toThrow("exceeds 64 KiB");
  oversized.destroy();
  const broken = transport();
  const failed = readProtocolLine(broken);
  broken.emit("error", new Error("transport failed"));
  await expect(failed).rejects.toThrow("transport failed");
  broken.destroy();
  jest.useFakeTimers();
  try {
    const socket = transport();
    const timed = readProtocolLine(socket);
    jest.advanceTimersByTime(5000);
    await expect(timed).rejects.toThrow("timed out");
    socket.destroy();
  } finally {
    jest.useRealTimers();
  }
});

it("refuses downgrades and unsupported servers before forwarding terminal input", async () => {
  const socket = transport();
  const result = negotiateShellConnection(socket, true);
  expect(socket.write).not.toHaveBeenCalled();
  send(socket, greeting);
  await Promise.resolve();
  expect(socket.write).toHaveBeenCalledWith('{"readOnly":true}\n');
  send(socket, { readOnly: false });
  await expect(result).rejects.toThrow("did not accept");
  socket.destroy();
  const old = transport();
  const incompatible = negotiateShellConnection(old, true);
  send(old, { ...greeting, version: 4 });
  await expect(incompatible).rejects.toThrow();
  expect(old.write).not.toHaveBeenCalled();
  old.destroy();
});

it("validates requests before accepting a session", async () => {
  const socket = transport();
  const accepted = acceptShellConnection(socket, false);
  send(socket, { readOnly: "true" });
  await expect(accepted).rejects.toThrow();
  expect(socket.write).toHaveBeenCalledTimes(1);
  socket.destroy();
});
