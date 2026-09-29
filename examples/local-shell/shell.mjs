import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectShell } from "@bluelibs/runner/node";

await connectShell({
  readOnly: process.argv.includes("--read-only"),
  socketPath: join(tmpdir(), `runner-shell-${process.getuid()}`, "example.sock"),
});
