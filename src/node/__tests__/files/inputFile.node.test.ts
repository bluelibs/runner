import { Readable } from "stream";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { NodeInputFile, toPassThrough } from "../../files";

describe("NodeInputFile", () => {
  it("resolves stream once and supports toTempFile", async () => {
    const payload = Buffer.from("HelloFile");
    const f1 = new NodeInputFile(
      { name: "a.txt", type: "text/plain" } as unknown as {
        name: string;
        type: string;
      },
      Readable.from(payload),
    );

    // resolve() returns a stream that we can consume
    const { stream } = await f1.resolve();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (c: any) =>
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
      );
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    expect(
      Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8"),
    ).toBe("HelloFile");

    // Subsequent stream() calls should throw (single-use)
    expect(() => f1.stream()).toThrow(/already consumed/i);

    // New instance to test toTempFile
    const f2 = new NodeInputFile(
      { name: "b.txt" } as unknown as { name: string },
      Readable.from(payload),
    );
    const { path, bytesWritten } = await f2.toTempFile();
    expect(bytesWritten).toBe(payload.length);
    const disk = await fs.promises.readFile(path);
    expect(disk.equals(payload as unknown as any)).toBe(true);
  });

  it("throws when stream is not available and toPassThrough works", async () => {
    const payload = Buffer.from("PTS");
    const src = Readable.from(payload as unknown as any);
    const pt = toPassThrough(src);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      pt.on("data", (c: any) =>
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
      );
      pt.on("end", () => resolve());
      pt.on("error", reject);
    });
    expect(
      Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8"),
    ).toBe("PTS");

    const f = new NodeInputFile(
      { name: "x" } as unknown as { name: string },
      Readable.from("data"),
    );
    // Corrupt internal stream to simulate unavailable stream
    (f as unknown as { _consumed: boolean })._consumed = false;
    (f as unknown as { _stream: unknown })._stream = null;
    expect(() => f.stream()).toThrow(/not available/i);
  });

  it("toTempFile sanitizes name and falls back to 'upload' when empty", async () => {
    const payload = Buffer.from("Z");
    // Empty name triggers fallback to 'upload'
    const f = new NodeInputFile(
      { name: "" } as unknown as { name: string },
      Readable.from(payload),
    );
    const { path: tempPath } = await f.toTempFile();
    const base = path.basename(tempPath);
    expect(base.startsWith("upload.")).toBe(true);
  });

  it("toTempFile counts non-Buffer string chunks as bytes (branch)", async () => {
    // Create a stream that emits string chunks
    const src = new Readable({
      read() {
        this.push("abc");
        this.push(null);
      },
    });
    const f = new NodeInputFile(
      { name: "s.txt" } as unknown as { name: string },
      src,
    );
    const { bytesWritten } = await f.toTempFile();
    expect(bytesWritten).toBe(3);
  });

  it("toTempFile accepts explicit directory (branch)", async () => {
    const payload = Buffer.from("DIR");
    const tempDir = os.tmpdir();
    const f = new NodeInputFile(
      { name: "dir.txt" } as unknown as { name: string },
      Readable.from(payload),
    );
    const { path: tempFilePath, bytesWritten } = await f.toTempFile(tempDir);
    expect(bytesWritten).toBe(payload.length);
    const content = await fs.promises.readFile(tempFilePath);
    expect(content.equals(payload as unknown as any)).toBe(true);
  });

  it("toTempFile rejects when pipeline errors (branch)", async () => {
    // Create a stream that errors during read
    const src = new Readable({
      read(this: Readable) {
        this.emit("error", new Error("boom"));
      },
    });
    const f = new NodeInputFile(
      { name: "err.txt" } as unknown as { name: string },
      src as unknown as Readable,
    );
    await expect(f.toTempFile()).rejects.toThrow(/boom/);
  });
});
