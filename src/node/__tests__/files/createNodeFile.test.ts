import { createNodeFile, NodeInputFile } from "../../index";
import { Readable } from "stream";

describe("createNodeFile helper", () => {
  it("uses default id when none is provided", () => {
    const file = createNodeFile({ name: "auto.bin" }, {});
    expect(file.id).toBe("F1");
    expect(file.meta.name).toBe("auto.bin");
  });
  it("creates a File sentinel with _node sidecar", () => {
    const f = createNodeFile(
      { name: "x.txt", type: "text/plain" },
      { stream: Readable.from("abc") },
      "ID1",
    );
    expect(f.$runnerFile).toBe("File");
    expect(f.id).toBe("ID1");
    expect(f.meta.name).toBe("x.txt");
    expect(typeof f._node).toBe("object");
    expect(typeof (f as any)._node.stream).toBe("object");
  });

  it("re-exports NodeInputFile from node entry", () => {
    const file = new NodeInputFile(
      { name: "entry.txt" } as unknown as { name: string },
      Readable.from("entry"),
    );
    expect(file).toBeInstanceOf(NodeInputFile);
    expect(file.name).toBe("entry.txt");
  });
});
