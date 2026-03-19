import { PlatformAdapter, resetPlatform, setPlatform } from "../../platform";
import { normalizeRunOptions } from "../../tools/normalizeRunOptions";

describe("normalizeRunOptions", () => {
  beforeEach(() => {
    resetPlatform();
  });

  afterEach(() => {
    resetPlatform();
  });

  it("preserves an explicit null printThreshold outside test env", () => {
    const mockAdapter = new PlatformAdapter();

    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "production";
      return undefined;
    });

    setPlatform(mockAdapter);

    expect(
      normalizeRunOptions({
        logs: {
          printThreshold: null,
        },
      }).logs.printThreshold,
    ).toBeNull();
  });

  it("defaults printThreshold to info outside test env when missing", () => {
    const mockAdapter = new PlatformAdapter();

    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "production";
      return undefined;
    });

    setPlatform(mockAdapter);

    expect(normalizeRunOptions({}).logs.printThreshold).toBe("info");
  });

  it("defaults printThreshold to null in test env when missing", () => {
    const mockAdapter = new PlatformAdapter();

    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "test";
      return undefined;
    });

    setPlatform(mockAdapter);

    expect(normalizeRunOptions({}).logs.printThreshold).toBeNull();
  });
});
