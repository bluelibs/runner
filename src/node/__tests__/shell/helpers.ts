import { negotiateShellConnection } from "../../shell/protocol";
import { runInThisContext } from "node:vm";
import { createConnection } from "node:net";
import { EventEmitter } from "node:events";

export function openShell(
  socketPath: string,
  readOnly = false,
  options: { terminal?: boolean; historyFile?: string } = {},
) {
  const socket = createConnection(socketPath);
  const updates = new EventEmitter();
  let output = "";
  socket.once("connect", () => {
    void negotiateShellConnection(socket, readOnly, undefined, options).then(
      () => {
        socket.setEncoding("utf8");
        socket.on("data", (data: string) => {
          output += data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
          updates.emit("output");
        });
        socket.resume();
      },
      () => socket.destroy(),
    );
  });
  socket.on("error", () => {});
  const waitFor = (text: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const check = () => {
        if (!output.includes(text)) return;
        clearTimeout(timer);
        updates.removeListener("output", check);
        resolve(output);
      };
      const timer = setTimeout(() => {
        updates.removeListener("output", check);
        reject(
          new Error(
            `Missing ${JSON.stringify(text)} in ${JSON.stringify(output)}`,
          ),
        );
      }, 3000);
      updates.on("output", check);
      check();
    });
  return {
    socket,
    waitFor,
    async command(code: string) {
      output = "";
      socket.write(`${code}\n`);
      return waitFor(readOnly ? "\nrunner[read-only]> " : "\nrunner> ");
    },
    output: () => output,
  };
}

// Node's built-in readline reads the real process, outside Jest's process clone.
export function useInteractiveTerminal() {
  const nativeProcess: NodeJS.Process = runInThisContext("process");
  const previousTerm = nativeProcess.env.TERM;
  const previousLocalTerm = process.env.TERM;
  beforeAll(() => {
    nativeProcess.env.TERM = "xterm";
    process.env.TERM = "xterm";
  });
  afterAll(() => {
    if (previousTerm === undefined) delete nativeProcess.env.TERM;
    else nativeProcess.env.TERM = previousTerm;
    if (previousLocalTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousLocalTerm;
  });
}

export const describeUnix =
  process.platform === "win32" ? describe.skip : describe;
