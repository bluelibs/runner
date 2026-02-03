import { createFile as createPlatformFile } from "../../platform/createFile";
import { createFile as createNodePlatformFile } from "../../node/platform/createFile";

describe("platform.createFile", () => {
  it("browser path returns _web sidecar shape when Blob is passed", () => {
    const blob = new Blob([new Uint8Array(Buffer.from("hi"))], {
      type: "text/plain",
    });
    const s = createPlatformFile(
      { name: "a.txt", type: "text/plain" },
      blob,
      "W1",
    ) as Record<string, any>;
    expect(s.$runnerFile).toBe("File");
    expect(s.id).toBe("W1");
    expect(s.meta?.name).toBe("a.txt");
    expect(s._web?.blob).toBeInstanceOf(Blob);
  });

  it("platform.createFile delegates to createWebFile and sets id default", () => {
    const blob = new Blob([new Uint8Array(Buffer.from("x"))], {
      type: "application/octet-stream",
    });
    const s = createPlatformFile({ name: "x.bin" }, blob) as Record<
      string,
      any
    >;
    expect(s.$runnerFile).toBe("File");
    expect(s.id).toBe("F1");
    expect(s.meta?.name).toBe("x.bin");
  });

  it("node path returns _node sidecar shape when buffer/stream passed", () => {
    const s = createNodePlatformFile(
      { name: "b.bin" },
      { buffer: Buffer.from([1, 2, 3]) },
      "N1",
    ) as Record<string, any>;
    expect(s.$runnerFile).toBe("File");
    expect(s.id).toBe("N1");
    expect(s._node?.buffer).toBeInstanceOf(Buffer);
  });

  it("node path sets default id when not provided", () => {
    const s = createNodePlatformFile(
      { name: "c.bin" },
      { buffer: Buffer.from([9]) },
    ) as Record<string, any>;
    expect(s.$runnerFile).toBe("File");
    expect(s.id).toBe("F1");
  });
});
