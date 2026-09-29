import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Match, r, resources, run } from "@bluelibs/runner/node";

const directory = join(tmpdir(), `runner-shell-${process.getuid()}`);
await mkdir(directory, { mode: 0o700, recursive: true });
const socketPath = join(directory, "example.sock");

const counter = r.resource("counter").init(async () => ({ value: 0 })).build();
const increment = r
  .task("increment")
  .inputSchema({ amount: Match.Integer })
  .dependencies({ counter })
  .run(async ({ amount }, { counter }) => {
    counter.value += amount;
    return counter.value;
  })
  .build();

const app = r
  .resource("app")
  .register([counter, increment, resources.shell.with({ socketPath })])
  .build();

await run(app);
console.log(`Shell socket: ${socketPath}`);
console.log("Connect from another terminal with node examples/local-shell/shell.mjs");
