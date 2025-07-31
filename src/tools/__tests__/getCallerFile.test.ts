import { generateCallerIdFromFile } from "../getCallerFile";

describe("generateCallerIdFromFile", () => {
  it("should generate a symbol from a path containing src", () => {
    const filePath =
      "/Users/theodordiaconu/Projects/runner/src/globals/resources/queue.resource.ts";
    const expectedSymbol = Symbol.for("globals:resources:queue.resource");
    expect(generateCallerIdFromFile(filePath)).toEqual(expectedSymbol);
  });

  it("should generate a symbol from a path not containing src", () => {
    const filePath =
      "/Users/theodordiaconu/Projects/runner/dist/globals/resources/queue.resource.ts";
    const expectedSymbol = Symbol.for("dist:globals:resources:queue.resource");
    expect(generateCallerIdFromFile(filePath)).toEqual(expectedSymbol);
  });

  it("should handle paths with few parts when src is not present", () => {
    const filePath = "a/b/c.ts";
    const expectedSymbol = Symbol.for("a:b:c");
    expect(generateCallerIdFromFile(filePath)).toEqual(expectedSymbol);
  });

  it("should handle paths with backslashes", () => {
    const filePath =
      "C:\\Users\\theodordiaconu\\Projects\\runner\\src\\globals\\resources\\queue.resource.ts";
    const expectedSymbol = Symbol.for("globals:resources:queue.resource");
    expect(generateCallerIdFromFile(filePath)).toEqual(expectedSymbol);
  });

  it("should handle file names without extensions", () => {
    const filePath =
      "/Users/theodordiaconu/Projects/runner/src/globals/resources/queue.resource";
    const expectedSymbol = Symbol.for("globals:resources:queue.resource");
    expect(generateCallerIdFromFile(filePath)).toEqual(expectedSymbol);
  });

  it("should handle file names with multiple dots", () => {
    const filePath =
      "/Users/theodordiaconu/Projects/runner/src/globals/resources/queue.resource.test.ts";
    const expectedSymbol = Symbol.for("globals:resources:queue.resource.test");
    expect(generateCallerIdFromFile(filePath)).toEqual(expectedSymbol);
  });

  it("should generate a symbol from a path containing node_modules", () => {
    const filePath =
      "/Users/theodordiaconu/Projects/runner/node_modules/some-package/dist/index.js";
    const expectedSymbol = Symbol.for("some-package:dist:index");
    expect(generateCallerIdFromFile(filePath)).toEqual(expectedSymbol);
  });
});
