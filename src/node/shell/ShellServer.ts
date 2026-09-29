import { AsyncLocalStorage } from "node:async_hooks";
import { acceptShellConnection } from "./protocol";
import { acceptsShellCommands } from "./sessionScope";
import { createServer, type Server, type Socket } from "node:net";
import type { RunResult } from "../../models/RunResult";
import { assertPrivateSocketDirectory } from "./socketPath";
import { startShellCommand } from "./commandSession";
import { startShellSession } from "./session";
import { shellError } from "./errors";

/** Lifecycle-owned local shell listener for one Runner container. */
export class ShellServer {
  readonly #executionScope = new AsyncLocalStorage<boolean>();
  private readonly server: Server;
  private readonly connections = new Set<Socket>();
  private listening: Promise<void> | undefined;
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
      void acceptShellConnection(socket, requireReadOnly)
        .then(
          async ({ readOnly, run, terminal, historyFile }) => {
            if (!acceptsShellCommands(runtime)) {
              socket.destroy();
              return;
            }
            if (run !== undefined) {
              startShellCommand(
                socket,
                runtime,
                this.#executionScope,
                readOnly,
                run,
              );
            } else {
              await startShellSession(
                socket,
                runtime,
                this.#executionScope,
                readOnly,
                terminal,
                historyFile,
              );
            }
          },
          () => socket.destroy(),
        )
        .catch((error: unknown) =>
          socket.end(`Shell setup failed: ${String(error)}\n`),
        );
    });
  }

  /** Whether the current async execution belongs to a read-only session of this shell. */
  isReadOnly(): boolean {
    return this.#executionScope.getStore() === true;
  }

  /** Opens the socket. Existing paths are never deleted or taken over. */
  async listen(): Promise<void> {
    if (this.closing) {
      throw shellError.new({
        message: "Cannot reopen a closed shell listener.",
      });
    }
    return (this.listening ??= this.openListener());
  }

  private async openListener(): Promise<void> {
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
      this.closing = this.closeListener();
    }
    return this.closing;
  }

  private async closeListener(): Promise<void> {
    // Startup owns the socket until it settles, even before server.listening is true.
    await this.listening?.catch(() => undefined);
    for (const socket of this.connections) socket.destroy();
    if (this.server.listening) {
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }
  }
}
