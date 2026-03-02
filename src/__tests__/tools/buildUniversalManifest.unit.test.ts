import { Readable } from "stream";
import { createFile as createNodeFile } from "../../node/platform/createFile";
import { createWebFile } from "../../platform/createWebFile";
import { buildUniversalManifest } from "../../tools/buildUniversalManifest";

describe("buildUniversalManifest", () => {
  it("collects node buffer files and strips sidecars", () => {
    const nodeFile = createNodeFile(
      { name: "a.bin" },
      { buffer: Buffer.from([1]) },
      "NB",
    );

    const result = buildUniversalManifest({ a: 1, file: nodeFile });
    expect(result.nodeFiles).toHaveLength(1);
    expect(result.nodeFiles[0].id).toBe("NB");
    expect(result.nodeFiles[0].source.type).toBe("buffer");
    expect((result.input as any).file._node).toBeUndefined();
    expect((result.input as any).file.$runnerFile).toBe("File");
  });

  it("collects node stream files nested inside arrays", () => {
    const nodeFile = createNodeFile(
      { name: "stream.txt" },
      { stream: Readable.from("x") },
      "NS",
    );
    const result = buildUniversalManifest({ arr: [{ nested: nodeFile }] });

    expect(result.nodeFiles).toHaveLength(1);
    expect(result.nodeFiles[0].id).toBe("NS");
    expect(result.nodeFiles[0].source.type).toBe("stream");
    expect((result.input as any).arr[0].nested._node).toBeUndefined();
  });

  it("collects web blob files and strips sidecars", () => {
    const webFile = createWebFile(
      { name: "web.bin" },
      new Blob([new Uint8Array([1])]),
      "WB",
    );
    const result = buildUniversalManifest({ webFile });

    expect(result.webFiles).toHaveLength(1);
    expect(result.webFiles[0].id).toBe("WB");
    expect((result.input as any).webFile._web).toBeUndefined();
  });

  it("keeps sentinels when sidecars are absent", () => {
    const pseudoFile = {
      $runnerFile: "File",
      id: "NONE",
      meta: { name: "none.bin" },
    };
    const result = buildUniversalManifest({ pseudoFile });

    expect(result.nodeFiles).toEqual([]);
    expect(result.webFiles).toEqual([]);
    expect((result.input as any).pseudoFile).toEqual({
      $runnerFile: "File",
      id: "NONE",
      meta: { name: "none.bin" },
    });
  });
});
