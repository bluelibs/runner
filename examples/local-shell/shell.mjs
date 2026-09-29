import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { connectShell, runShell } from "@bluelibs/runner/node";

const { values } = parseArgs({ options: {
  run: { type: "string" },
  "read-only": { type: "boolean", default: false },
} });
const options = {
  readOnly: values["read-only"],
  socketPath: join(tmpdir(), `runner-shell-${process.getuid()}`, "example.sock"),
};
if (values.run !== undefined) {
  const result = await runShell({ ...options, command: values.run });
  process.stdout.write(result.output);
  process.exitCode = result.success ? 0 : 1;
} else {
  await connectShell(options);
}
