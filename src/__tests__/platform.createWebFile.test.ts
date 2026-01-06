import { createWebFile } from "../platform/createWebFile";

describe("platform.createWebFile", () => {
  it("uses default id when not provided", () => {
    const blob = new Blob([Buffer.from("def")], {
      type: "application/octet-stream",
    });
    const s = createWebFile({ name: "x.bin" }, blob) as any;
    expect(s.$runnerFile).toBe("File");
    expect(s.id).toBe("F1");
    expect(s.meta?.name).toBe("x.bin");
    expect(s._web?.blob).toBeInstanceOf(Blob);
  });
});
