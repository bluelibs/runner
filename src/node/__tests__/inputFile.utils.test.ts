import { Readable } from "stream";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NodeInputFile } from "../inputFile.model";
import { readInputFileToBuffer, writeInputFileToPath } from "../index";

describe("inputFile.utils", () => {
  it("readInputFileToBuffer reads the full content", async () => {
    const payload = Buffer.from("UTILS_BUFFER_CONTENT");
    const file = new NodeInputFile(
      { name: "a.bin" } as any,
      Readable.from(payload) as any,
    );
    const buf = await readInputFileToBuffer(file as any);
    expect(buf.equals(payload as any)).toBe(true);
  });

  it("writeInputFileToPath writes to disk and reports bytes", async () => {
    const payload = Buffer.from("UTILS_WRITE_CONTENT");
    const file = new NodeInputFile(
      { name: "b.bin" } as any,
      Readable.from(payload) as any,
    );
    const target = path.join(
      os.tmpdir(),
      `runner-test-${Date.now()}-${Math.random()}.bin`,
    );
    const { bytesWritten } = await writeInputFileToPath(file as any, target);
    expect(bytesWritten).toBe(payload.length);
    const disk = await fs.promises.readFile(target);
    expect(disk.equals(payload as any)).toBe(true);
  });

  it("handles string and non-buffer chunks for readInputFileToBuffer", async () => {
    const src = Readable.from(["A", Buffer.from("B"), 123]);
    const file = new NodeInputFile({ name: "mix.bin" } as any, src as any);
    const buf = await readInputFileToBuffer(file as any);
    expect(buf.toString("utf8")).toBe("AB123");
  });

  it("handles string and non-buffer chunks for writeInputFileToPath", async () => {
    const src = Readable.from(["A", Buffer.from("B"), 123]);
    const file = new NodeInputFile({ name: "mix2.bin" } as any, src as any);
    const target = path.join(
      os.tmpdir(),
      `runner-test-${Date.now()}-${Math.random()}.bin`,
    );
    const { bytesWritten } = await writeInputFileToPath(file as any, target);
    const disk = await fs.promises.readFile(target);
    expect(disk.toString("utf8")).toBe("AB123");
    expect(bytesWritten).toBe(Buffer.byteLength("AB123"));
  });

  it("propagates stream errors for readInputFileToBuffer", async () => {
    const src = new Readable({
      read() {
        this.emit("error", new Error("boom-read"));
      },
    });
    const file = new NodeInputFile({ name: "err.bin" } as any, src as any);
    await expect(readInputFileToBuffer(file as any)).rejects.toThrow(
      /boom-read/,
    );
  });

  it("propagates pipeline errors for writeInputFileToPath", async () => {
    const src = new Readable({
      read() {
        this.push("x");
        process.nextTick(() => this.emit("error", new Error("boom-write")));
      },
    });
    const file = new NodeInputFile({ name: "err2.bin" } as any, src as any);
    const target = path.join(
      os.tmpdir(),
      `runner-test-${Date.now()}-${Math.random()}.bin`,
    );
    await expect(writeInputFileToPath(file as any, target)).rejects.toThrow(
      /boom-write/,
    );
  });
});
