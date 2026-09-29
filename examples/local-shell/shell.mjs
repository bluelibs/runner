import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectShell } from "@bluelibs/runner/node";

await connectShell({
  socketPath: join(tmpdir(), `runner-shell-${process.getuid()}`, "example.sock"),
});
