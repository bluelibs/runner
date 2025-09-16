import { buildNodeManifest } from "../upload/manifest.node";

describe("buildNodeManifest - extra branches", () => {
  it("keeps File sentinel without _node and does not collect it", () => {
    const input: any = {
      file1: { $ejson: "File", id: "X", meta: { name: "x.bin" } },
      plain: { k: 1 },
    };
    const m = buildNodeManifest(input);
    expect(m.files.length).toBe(0);
    expect((m.input as any).file1.$ejson).toBe("File");
    expect((m.input as any).file1.id).toBe("X");
  });
});

