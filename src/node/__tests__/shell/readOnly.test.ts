import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { r, resources, run } from "../../node";
import { openShell, useInteractiveTerminal, describeUnix } from "./helpers";

useInteractiveTerminal();

describeUnix("shell read-only execution", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ro-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function boot(name: string, readOnly = false) {
    const denied = r
      .error("writeDenied")
      .format(() => "Read-only session")
      .build();
    const database = r
      .resource("database")
      .dependencies({ shell: resources.shell })
      .init(async (_, { shell }) => {
        let count = 0;
        return {
          async mode() {
            await Promise.resolve();
            return shell.isReadOnly();
          },
          write() {
            if (shell.isReadOnly()) throw denied.new();
            return ++count;
          },
          count: () => count,
        };
      })
      .build();
    const inspect = r
      .task("inspect")
      .dependencies({ database })
      .run(async (_, { database }) => database.mode())
      .build();
    const socketPath = join(directory, `${name}.sock`);
    const runtime = await run(
      r
        .resource(name)
        .register([
          database,
          inspect,
          resources.shell.with({ socketPath, readOnly }),
        ])
        .build(),
    );
    return { runtime, database, socketPath };
  }

  it("scopes resource guards across await, tasks, clear, and concurrent sessions", async () => {
    const { runtime, database, socketPath } = await boot("app");
    try {
      const reader = openShell(socketPath, true);
      const writer = openShell(socketPath);
      await reader.waitFor("runner[read-only]> ");
      await writer.waitFor("runner> ");
      await reader.command(
        'const db = runtime.getResourceValue("app.database")',
      );
      expect(await reader.command("await db.mode()")).toContain("true");
      expect(
        await reader.command('await runtime.runTask("app.tasks.inspect")'),
      ).toContain("true");
      expect(await reader.command("db.write()")).toContain("Read-only session");
      expect(
        await writer.command(
          'runtime.getResourceValue("app.database").write()',
        ),
      ).toContain("1");
      expect(await runtime.runTask("app.tasks.inspect")).toBe(false);
      expect(runtime.getResourceValue(database).count()).toBe(1);
      await reader.command(".clear");
      expect(
        await reader.command(
          'await runtime.getResourceValue("app.database").mode()',
        ),
      ).toContain("true");
      expect(
        await reader.command(
          'await new Promise(resolve => setTimeout(async () => resolve(await runtime.getResourceValue("app.database").mode()), 10))',
        ),
      ).toContain("true");
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps policy isolated between containers and allows a server read-only floor", async () => {
    const first = await boot("first", true);
    const second = await boot("second");
    try {
      const client = openShell(first.socketPath, true);
      await client.waitFor("runner[read-only]> ");
      const other = second.runtime.getResourceValue(second.database);
      // A callback into another container must see that container's own scope.
      const firstDb = first.runtime.getResourceValue(first.database);
      firstDb.mode = async () => other.mode();
      expect(
        await client.command(
          'await runtime.getResourceValue("first.database").mode()',
        ),
      ).toContain("false");
      const forced = openShell(first.socketPath);
      await forced.waitFor("runner[read-only]> ");
      forced.socket.write(
        'runtime.getResourceValue("first.database").write()\n',
      );
      await forced.waitFor("Read-only session");
    } finally {
      await first.runtime.dispose();
      await second.runtime.dispose();
    }
  });
});
