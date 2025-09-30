import { buildUniversalManifest } from "../tunnels/buildUniversalManifest";
import { createFile as createNodeFile } from "../node/platform/createFile";
import { createWebFile } from "../platform/createWebFile";
import { Readable } from "stream";

describe("buildUniversalManifest", () => {
  it("collects node buffer files and strips sidecars", () => {
    const nf = createNodeFile({ name: "a.bin" }, { buffer: Buffer.from([1]) }, "NB");
    const input = { a: 1, f: nf } as const;
    const out = buildUniversalManifest(input);
    expect(out.nodeFiles).toHaveLength(1);
    expect(out.nodeFiles[0].id).toBe("NB");
    expect(out.nodeFiles[0].source.type).toBe("buffer");
    // _node sidecar removed in cloned input
    expect((out.input as any).f._node).toBeUndefined();
    expect((out.input as any).f.$ejson).toBe("File");
  });

  it("collects node stream files and nested arrays/objects", () => {
    const nf = createNodeFile({ name: "s.txt" }, { stream: Readable.from("x") }, "NS");
    const input = { arr: [{ nested: nf }] } as const;
    const out = buildUniversalManifest(input);
    expect(out.nodeFiles).toHaveLength(1);
    expect(out.nodeFiles[0].id).toBe("NS");
    expect(out.nodeFiles[0].source.type).toBe("stream");
    expect(((out.input as any).arr[0].nested)._node).toBeUndefined();
  });

  it("collects web blob files and strips sidecars", () => {
    const wf = createWebFile(
      { name: "w.bin" },
      new Blob([new Uint8Array([1])]),
      "WB",
    );
    const out = buildUniversalManifest({ wf });
    expect(out.webFiles).toHaveLength(1);
    expect(out.webFiles[0].id).toBe("WB");
    expect((out.input as any).wf._web).toBeUndefined();
  });
});
