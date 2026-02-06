import {
  defineTask,
  defineResource,
  defineEvent,
  defineTaskMiddleware,
} from "../../define";
import { symbolFilePath } from "../../defs";
import { getCallerFile } from "../../tools/getCallerFile";

describe("getCallerFile", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should return the file name of the caller", () => {
    function testFunction() {
      return getCallerFile();
    }

    const callerFile = testFunction();

    expect(callerFile).toBeDefined();
    expect(callerFile).toContain("getCallerFile.test"); // we don't use .ts because for coverage it gets compiled to js
  });

  it("Should work with tasks, resources, middleware and events", () => {
    const task = defineTask({
      id: "task",
      run: async () => {},
    });
    const resource = defineResource({
      id: "resource",
      init: async () => {},
    });

    const mw = defineTaskMiddleware({
      id: "middleware",
      run: async () => {},
    });

    const event = defineEvent({
      id: "event",
    });

    expect(task[symbolFilePath]).toBeDefined();
    expect(resource[symbolFilePath]).toBeDefined();
    expect(mw[symbolFilePath]).toBeDefined();
    expect(event[symbolFilePath]).toBeDefined();

    expect(task[symbolFilePath]).toContain("getCallerFile.test");
    expect(resource[symbolFilePath]).toContain("getCallerFile.test");
    expect(mw[symbolFilePath]).toContain("getCallerFile.test");
    expect(event[symbolFilePath]).toContain("getCallerFile.test");
  });

  it("returns 'unknown' in non-node environments (mocked)", async () => {
    // Mock process.versions to simulate non-node environment
    // getCallerFile uses inline node detection: typeof process.versions.node === "string"
    const originalVersions = process.versions;
    Object.defineProperty(process, "versions", {
      value: { ...originalVersions, node: undefined },
      configurable: true,
    });
    try {
      const out = getCallerFile();
      expect(out).toBe("unknown");
    } finally {
      Object.defineProperty(process, "versions", {
        value: originalVersions,
        configurable: true,
      });
    }
  });

  // No need for further branch gymnastics; non-node path is constant
});
