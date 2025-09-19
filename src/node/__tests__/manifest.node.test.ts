import { Readable } from "stream";
import { buildNodeManifest } from "../upload/manifest.node";

describe("buildNodeManifest (node)", () => {
  it("collects file sources and strips local sidecars", () => {
    const input = {
      a: 1,
      file1: {
        $ejson: "File",
        id: "F1",
        meta: { name: "n1.txt", type: "text/plain" },
        _node: { buffer: Buffer.from("x") },
      },
      arr: [
        {
          nested: {
            $ejson: "File",
            id: "F2",
            meta: { name: "n2.bin" },
            _node: { stream: Readable.from(Buffer.from("y")) },
          },
        },
      ],
    } as any;

    const manifest = buildNodeManifest(input);
    expect(manifest.files.length).toBe(2);
    const ids = manifest.files.map((f) => f.id).sort();
    expect(ids).toEqual(["F1", "F2"]);
    const kinds = manifest.files.map((f) => f.source.type).sort();
    expect(kinds).toEqual(["buffer", "stream"]);

    // Ensure the cloned input preserves File sentinel with no _node
    const clone = manifest.input as any;
    expect(clone.file1.$ejson).toBe("File");
    expect("_node" in clone.file1).toBe(false);
    expect(clone.arr[0].nested.$ejson).toBe("File");
    expect("_node" in clone.arr[0].nested).toBe(false);
  });
});

