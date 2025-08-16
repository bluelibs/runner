import {
  defineTask,
  defineResource,
  defineMiddleware,
  defineEvent,
} from "../../define";
import { symbolFilePath } from "../../defs";
import { getCallerFile } from "../../tools/getCallerFile";

describe("getCallerFile", () => {
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

    const middleware = defineMiddleware({
      id: "middleware",
      run: async () => {},
    });

    const event = defineEvent({
      id: "event",
    });

    expect((task as any)[symbolFilePath]).toBeDefined();
    expect((resource as any)[symbolFilePath]).toBeDefined();
    expect((middleware as any)[symbolFilePath]).toBeDefined();
    expect((event as any)[symbolFilePath]).toBeDefined();

    expect((task as any)[symbolFilePath]).toContain("getCallerFile.test");
    expect((resource as any)[symbolFilePath]).toContain("getCallerFile.test");
    expect((middleware as any)[symbolFilePath]).toContain("getCallerFile.test");
    expect((event as any)[symbolFilePath]).toContain("getCallerFile.test");
  });
});
