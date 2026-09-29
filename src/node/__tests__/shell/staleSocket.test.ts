import * as fs from "node:fs/promises";
import * as net from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reclaimStaleSocket } from "../../shell/staleSocket";
import { describeUnix } from "./helpers";

describeUnix("stale socket recovery races", () => {
  let directory: string;
  let path: string;
  let server: net.Server;
  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "reclaim-"));
    path = join(directory, "runner.sock");
    server = net.createServer();
    server.listen(path);
    await once(server, "listening");
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  });

  it.each([
    null,
    "failure",
    {},
    Object.assign(new Error("denied"), { code: "EACCES" }),
  ])("propagates unexpected filesystem failures: %j", async (error) => {
    jest.spyOn(fs, "lstat").mockRejectedValueOnce(error);
    await expect(reclaimStaleSocket(path)).rejects.toBe(error);
  });

  it("refuses an existing socket owned by another user", async () => {
    jest.spyOn(process, "getuid").mockReturnValue(process.getuid!() + 1);
    await expect(reclaimStaleSocket(path)).rejects.toThrow(
      "not a socket owned",
    );
  });

  it.each(["disappeared", "changed", "device changed", "denied", "timeout"])(
    "handles a socket that %s during its probe",
    async (scenario) => {
      const probe = new net.Socket();
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      jest.spyOn(net, "createConnection").mockImplementation(() => {
        entered();
        return probe;
      });
      const result = reclaimStaleSocket(path).then(
        (release) => ({ release, error: undefined }),
        (error: unknown) => ({ release: undefined, error }),
      );
      await started;
      // A concurrent recovery must never pass the marker held by this probe.
      await expect(reclaimStaleSocket(path)).rejects.toMatchObject({
        code: "EEXIST",
      });
      if (scenario === "disappeared" || scenario === "changed")
        await fs.unlink(path);
      if (scenario === "changed") await fs.writeFile(path, "replacement");
      if (scenario === "device changed") {
        const stats = await fs.lstat(path, { bigint: true });
        jest
          .spyOn(fs, "lstat")
          .mockResolvedValueOnce(Object.assign(stats, { dev: stats.dev + 1n }));
      }
      if (scenario === "timeout") probe.emit("timeout");
      else
        probe.emit(
          "error",
          Object.assign(new Error("probe"), {
            code: scenario === "denied" ? "EACCES" : "ENOENT",
          }),
        );
      const outcome = await result;
      if (scenario === "disappeared") {
        expect(outcome.error).toBeUndefined();
        await outcome.release!();
      } else {
        expect(outcome.error).toBeInstanceOf(Error);
        if (scenario === "changed")
          expect(await fs.readFile(path, "utf8")).toBe("replacement");
      }
      expect(probe.destroyed).toBe(true);
      await expect(fs.lstat(`${path}.reclaim`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
});
