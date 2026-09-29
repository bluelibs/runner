import * as net from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { r, run } from "../../node";
import { ShellServer } from "../../shell/ShellServer";
import { readProtocolLine } from "../../shell/protocolLine";
import { openShell, describeUnix, useInteractiveTerminal } from "./helpers";

useInteractiveTerminal();
describeUnix("shell lifecycle admission", () => {
  it.each(["before connection", "during handshake"])(
    "refuses new sessions %s when cooling down",
    async (stage) => {
      const directory = await mkdtemp(join(tmpdir(), "sa-"));
      const runtime = await run(r.resource("app").build());
      const shell = new ShellServer(join(directory, "shell.sock"), runtime);
      await shell.listen();
      try {
        if (stage === "before connection") runtime.store.beginCoolingDown();
        const socket = net.createConnection(shell.socketPath);
        await once(socket, "connect");
        const closed = once(socket, "close");
        if (stage === "during handshake") {
          await readProtocolLine(socket);
          runtime.store.beginCoolingDown();
          socket.write('{"readOnly":true}\n');
        }
        socket.resume();
        await closed;
      } finally {
        await shell.close();
        await runtime.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("closes an established REPL on a transport error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sa-"));
    const runtime = await run(r.resource("app").build());
    const factory = jest.spyOn(net, "createServer");
    const shell = new ShellServer(join(directory, "shell.sock"), runtime);
    const server: net.Server = factory.mock.results[0].value;
    factory.mockRestore();
    await shell.listen();
    try {
      const connection = once(server, "connection");
      const client = openShell(shell.socketPath);
      const [socket] = await connection;
      await client.waitFor("runner> ");
      const closed = once(client.socket, "close");
      socket.emit("error", new Error("transport failed"));
      await closed;
    } finally {
      await shell.close();
      await runtime.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
