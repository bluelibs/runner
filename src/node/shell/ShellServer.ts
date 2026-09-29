import { AsyncLocalStorage } from "node:async_hooks";
import { acceptShellConnection } from "./protocol";
import { acceptsShellCommands } from "./sessionScope";
import { createServer, type Server, type Socket } from "node:net";
import type { RunResult } from "../../models/RunResult";
import { assertPrivateSocketDirectory } from "./socketPath";
import { startShellSession } from "./session";

/** Lifecycle-owned local shell listener for one Runner container. */
export class ShellServer {
  readonly #executionScope = new AsyncLocalStorage<boolean>();
  private readonly server: Server;
  private readonly connections = new Set<Socket>();
  private closing: Promise<void> | undefined;

  /** Creates a listener without opening a socket until the resource is ready. */
  constructor(
    /** Absolute address of this container's local shell. */
    readonly socketPath: string,
    runtime: RunResult<unknown>,
    requireReadOnly = false,
  ) {
    this.server = createServer((socket) => {
      this.connections.add(socket);
      socket.on("error", () => socket.destroy());
      socket.once("close", () => this.connections.delete(socket));
      if (!acceptsShellCommands(runtime)) {
        socket.destroy();
        return;
      }
      void acceptShellConnection(socket, requireReadOnly).then(
        (readOnly) => {
          if (!acceptsShellCommands(runtime)) {
            socket.destroy();
            return;
          }
          startShellSession(socket, runtime, this.#executionScope, readOnly);
        },
        () => socket.destroy(),
      );
    });
  }

  /** Whether the current async execution belongs to a read-only session of this shell. */
  isReadOnly(): boolean {
    return this.#executionScope.getStore() === true;
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
