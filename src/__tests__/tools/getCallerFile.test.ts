import {
  defineTask,
  defineResource,
  defineMiddleware,
  defineEvent,
} from "../../define";
import { symbols } from "../../defs";
import {
  getCallerFile,
  generateCallerIdFromFile,
} from "../../tools/getCallerFile";

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

    expect((task as any)[symbols.filePath]).toBeDefined();
    expect((resource as any)[symbols.filePath]).toBeDefined();
    expect((middleware as any)[symbols.filePath]).toBeDefined();
    expect((event as any)[symbols.filePath]).toBeDefined();

    expect((task as any)[symbols.filePath]).toContain("getCallerFile.test");
    expect((resource as any)[symbols.filePath]).toContain("getCallerFile.test");
    expect((middleware as any)[symbols.filePath]).toContain(
      "getCallerFile.test"
    );
    expect((event as any)[symbols.filePath]).toContain("getCallerFile.test");
  });
});

describe("generateCallerIdFromFile", () => {
  it("should generate a symbol from a path containing src", () => {
    const filePath =
      "/Users/theodordiaconu/Projects/runner/src/globals/resources/queue.resource.ts";
    const expectedDescription = "globals.resources.queue.resource";
    expect(generateCallerIdFromFile(filePath).description).toEqual(
      expectedDescription
    );
  });

  it("should generate a symbol from a path not containing src", () => {
    const filePath =
      "/Users/theodordiaconu/Projects/runner/dist/globals/resources/queue.resource.ts";
    const expectedDescription = "dist.globals.resources.queue.resource";
    expect(generateCallerIdFromFile(filePath).description).toEqual(
      expectedDescription
    );
  });

  it("should handle paths with few parts when src is not present", () => {
    const filePath = "a/b/c.ts";
    const expectedDescription = "a.b.c";
    expect(generateCallerIdFromFile(filePath).description).toEqual(
      expectedDescription
    );
  });

  it("should handle paths with backslashes", () => {
    const filePath =
      "C:\\Users\\theodordiaconu\\Projects\\runner\\src\\globals\\resources\\queue.resource.ts";
    const expectedDescription = "globals.resources.queue.resource";
    expect(generateCallerIdFromFile(filePath).description).toEqual(
      expectedDescription
    );
  });

  it("should handle file names without extensions", () => {
    const filePath =
      "/Users/theodordiaconu/Projects/runner/src/globals/resources/queue.resource";
    const expectedDescription = "globals.resources.queue.resource";
    expect(generateCallerIdFromFile(filePath).description).toEqual(
      expectedDescription
    );
  });

  it("should handle file names with multiple dots", () => {
    const filePath =
      "/Users/theodordiaconu/Projects/runner/src/globals/resources/queue.resource.test.ts";
    const expectedDescription = "globals.resources.queue.resource.test";
    expect(generateCallerIdFromFile(filePath).description).toEqual(
      expectedDescription
    );
  });

  it("should generate a symbol from a path containing node_modules", () => {
    const filePath =
      "/Users/theodordiaconu/Projects/runner/node_modules/some-package/dist/index.js";
    const expectedDescription = "some-package.dist.index";
    expect(generateCallerIdFromFile(filePath).description).toEqual(
      expectedDescription
    );
  });

  it("should respect the fallbackParts argument", () => {
    const filePath = "a/b/c/d/e.ts";
    const expectedDescription = "d.e";
    expect(generateCallerIdFromFile(filePath, "", 2).description).toEqual(
      expectedDescription
    );
  });

  it("should append the suffix to the symbol description", () => {
    const filePath = "a/b/c.ts";
    const expectedDescription = "a.b.c.my-suffix";
    expect(generateCallerIdFromFile(filePath, "my-suffix").description).toEqual(
      expectedDescription
    );
  });

  it("should not append the suffix if it is already in the file name", () => {
    const filePath = "a/b/c.resource.ts";
    const expectedDescription = "a.b.c.resource";
    expect(generateCallerIdFromFile(filePath, "resource").description).toEqual(
      expectedDescription
    );
  });

  it("should handle empty path or path with no relevant parts", () => {
    // Test with empty string - this creates relevantParts = [""] which is not empty
    const filePath = "";
    const expectedDescription = ".suffix";
    expect(generateCallerIdFromFile(filePath, "suffix").description).toEqual(
      expectedDescription
    );

    // Test case where 'src' is at the end, making relevantParts empty (triggers line 77 else branch)
    const result = generateCallerIdFromFile("/some/path/src", "suffix");
    expect(result.description).toEqual(".suffix");
  });

  it("should use fallback parts when no src or node_modules found", () => {
    // Test path without src or node_modules to trigger the else branch (line 59)
    const filePath = "/some/other/deep/path/file.js";
    const expectedDescription = "other.deep.path.file";
    expect(generateCallerIdFromFile(filePath, "", 4).description).toEqual(
      expectedDescription
    );
  });
});
