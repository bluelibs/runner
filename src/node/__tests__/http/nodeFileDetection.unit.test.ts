import { Readable } from "stream";
import { hasNodeFile, isReadable } from "../../http/nodeFileDetection";

describe("nodeFileDetection", () => {
  it("detects direct Node-file sentinels", () => {
    const sentinel = {
      $runnerFile: "File",
      id: "file-1",
      _node: { buffer: new Uint8Array([1]) },
    };
    expect(hasNodeFile(sentinel)).toBe(true);
    expect(hasNodeFile({ nested: [sentinel] })).toBe(true);
  });

  it("returns false for plain values", () => {
    expect(hasNodeFile(undefined)).toBe(false);
    expect(hasNodeFile(null)).toBe(false);
    expect(hasNodeFile(42)).toBe(false);
    expect(hasNodeFile("file")).toBe(false);
    expect(hasNodeFile({ a: 1, b: [1, 2, { c: "x" }] })).toBe(false);
    // Incomplete sentinel shape is not a Node file.
    expect(hasNodeFile({ $runnerFile: "File", id: "x" })).toBe(false);
  });

  it("terminates on circular graphs without sentinels", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(hasNodeFile(cyclic)).toBe(false);

    const arr: unknown[] = [1, 2];
    arr.push(arr);
    expect(hasNodeFile(arr)).toBe(false);

    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { a };
    a.b = b;
    expect(hasNodeFile({ a, b })).toBe(false);
  });

  it("finds sentinels inside circular graphs", () => {
    const sentinel = {
      $runnerFile: "File",
      id: "file-2",
      _node: { stream: Readable.from(["x"]) },
    };
    const cyclic: Record<string, unknown> = { file: sentinel };
    cyclic.self = cyclic;
    expect(hasNodeFile(cyclic)).toBe(true);
  });

  it("handles shared references without looping", () => {
    const shared = { deep: [1, 2, 3] };
    expect(hasNodeFile({ left: shared, right: shared })).toBe(false);
  });

  it("detects Readable streams by duck-typing", () => {
    expect(isReadable(Readable.from(["chunk"]))).toBe(true);
    expect(isReadable({ hello: "world" })).toBe(false);
    expect(isReadable(null)).toBe(false);
  });
});
