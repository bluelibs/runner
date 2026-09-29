import { createServer, type Server, type Socket } from "node:net";
import type { RunResult } from "../../models/RunResult";
import { assertPrivateSocketDirectory } from "./socketPath";
import { startShellSession } from "./session";

/** Lifecycle-owned local shell listener for one Runner container. */
export class ShellServer {
  private readonly server: Server;
  private readonly connections = new Set<Socket>();
  private closing: Promise<void> | undefined;

  /** Creates a listener without opening a socket until the resource is ready. */
  constructor(
    /** Absolute address of this container's local shell. */
    readonly socketPath: string,
    runtime: RunResult<unknown>,
  ) {
    this.server = createServer((socket) => {
      this.connections.add(socket);
      socket.on("error", () => socket.destroy());
      socket.once("close", () => this.connections.delete(socket));
      startShellSession(socket, runtime);
    });
  }

  /** Opens the socket. Existing paths are never deleted or taken over. */
  async listen(): Promise<void> {
    await assertPrivateSocketDirectory(this.socketPath);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(this.socketPath, () => {
        this.server.removeListener("error", onError);
        resolve();
      });
    });
  }

  /** Disconnects sessions and closes the owned socket; safe to call again. */
  close(): Promise<void> {
    if (!this.closing) {
      for (const socket of this.connections) socket.destroy();
      this.closing = new Promise<void>((resolve) => {
        if (!this.server.listening) return resolve();
        this.server.close(() => resolve());
      });
    }
    return this.closing;
  }
}
