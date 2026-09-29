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
  /** Absolute Unix socket path in an owner-only directory; defaults to runner.sock in process.cwd() when started. */
  socketPath?: string;
  /** Require read-only sessions on the server; opt in to one on the connector. Defaults to false. */
  readOnly?: boolean;
}

/** Terminal connector options. The connector never starts another runtime. */
export interface ConnectShellOptions extends ShellConfig {
  /** Terminal capabilities; defaults to the connector's TERM. An explicit dumb terminal uses basic input. */
  terminal?: "auto" | "interactive" | "basic";
  /** Opt-in JSON-lines history file on the app host, inside an existing owner-only directory. */
  historyFile?: string;
  /** Interactive terminal input. Defaults to process.stdin. */
  input?: ShellInput;
  /** Interactive terminal output. Defaults to process.stdout. */
  output?: ShellOutput;
}

/** Noninteractive command options. The command runs in the existing app. */
export interface RunShellOptions extends ShellConfig {
  /** JavaScript source, including native REPL top-level await. */
  command: string;
}

/** Captured console and evaluation output, without REPL prompts. */
export interface ShellCommandResult {
  /** Whether the native REPL evaluator reported successful completion. */
  success: boolean;
  /** Console output and the final value, formatted as in the interactive shell. */
  output: string;
}
