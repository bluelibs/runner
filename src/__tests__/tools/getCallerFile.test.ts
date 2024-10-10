import {
  defineTask,
  defineResource,
  defineMiddleware,
  defineEvent,
} from "../../define";
import { symbols } from "../../defs";
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

    expect(task[symbols.filePath]).toBeDefined();
    expect(resource[symbols.filePath]).toBeDefined();
    expect(middleware[symbols.filePath]).toBeDefined();
    expect(event[symbols.filePath]).toBeDefined();

    expect(task[symbols.filePath]).toContain("getCallerFile.test");
    expect(resource[symbols.filePath]).toContain("getCallerFile.test");
    expect(middleware[symbols.filePath]).toContain("getCallerFile.test");
    expect(event[symbols.filePath]).toContain("getCallerFile.test");
  });
});
