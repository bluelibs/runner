import { createNodeFile } from "../index";
import { Readable } from "stream";

describe("createNodeFile helper", () => {
  it("uses default id when none is provided", () => {
    const file = createNodeFile({ name: "auto.bin" }, {});
    expect(file.id).toBe("F1");
    expect(file.meta.name).toBe("auto.bin");
  });
  it("creates an EJSON File sentinel with _node sidecar", () => {
    const f = createNodeFile(
      { name: "x.txt", type: "text/plain" },
      { stream: Readable.from("abc") },
      "ID1",
    );
    expect(f.$ejson).toBe("File");
    expect(f.id).toBe("ID1");
    expect(f.meta.name).toBe("x.txt");
    expect(typeof f._node).toBe("object");
    expect(typeof (f as any)._node.stream).toBe("object");
  });
});
