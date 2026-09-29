import type { REPLServer } from "node:repl";
import type { RunResult } from "../../models/RunResult";

export function addShellCommands(
  session: REPLServer,
  runtime: RunResult<unknown>,
  readOnly: boolean,
  terminal: boolean,
  historyFile?: string,
): void {
  for (const kind of ["task", "resource"] as const) {
    session.defineCommand(`${kind}s`, {
      help: `List accessible ${kind}s and their canonical IDs; optionally filter by ID or description.`,
      action(filter) {
        const definitions = runtime
          .inspect()
          .snapshot()
          .definitions.filter(
            (entry) => entry.kind === kind && entry.rootAccess?.accessible,
          );
        const lines = definitions
          .map(({ canonicalId }) => {
            const definition =
              kind === "task"
                ? runtime.store.tasks.get(canonicalId)!.task
                : runtime.store.resources.get(canonicalId)!.resource;
            return [
              canonicalId,
              definition.meta?.title,
              definition.meta?.description,
            ]
              .filter(Boolean)
              .join(" — ");
          })
          .filter((line) =>
            line.toLowerCase().includes(filter.trim().toLowerCase()),
          );
        this.output.write(
          `${lines.length ? lines.join("\n") : "No matching definitions."}\n`,
        );
        this.displayPrompt();
      },
    });
  }
  session.defineCommand("status", {
    help: "Show this shell's app, process, access mode, terminal and history settings.",
    action() {
      this.output.write(
        `App: ${runtime.root.id}\nProcess: ${process.pid}\nAccess: ${readOnly ? "read-only" : "read-write"}\nTerminal: ${terminal ? "interactive" : "basic"}\nHistory: ${historyFile ?? "memory only"}\n`,
      );
      this.displayPrompt();
    },
  });
}
