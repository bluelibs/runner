import type { Readable, Writable } from "node:stream";

/** Terminal input accepted by the shell connector. */
export interface ShellInput extends Readable {
  /** Whether input belongs to an interactive terminal. */
  readonly isTTY?: boolean;
  /** Current terminal raw-mode state. */
  readonly isRaw?: boolean;
  /** Changes terminal raw mode without taking ownership of the stream. */
  setRawMode(mode: boolean): unknown;
}

/** Terminal output accepted by the shell connector. */
export interface ShellOutput extends Writable {
  /** Whether output belongs to an interactive terminal. */
  readonly isTTY?: boolean;
}

/** Configuration for the optional, local-only runtime shell. */
export interface ShellConfig {
  /** Absolute Unix socket path inside an existing owner-only directory (0700). */
  socketPath: string;
}

/** Terminal connector options. The connector never starts another runtime. */
export interface ConnectShellOptions extends ShellConfig {
  /** Interactive terminal input. Defaults to process.stdin. */
  input?: ShellInput;
  /** Interactive terminal output. Defaults to process.stdout. */
  output?: ShellOutput;
}
