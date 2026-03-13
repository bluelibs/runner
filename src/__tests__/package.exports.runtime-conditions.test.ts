const packageJson = require("../../package.json") as {
  exports?: Record<string, unknown>;
};

interface ExportConditionMap {
  [key: string]: string | ExportConditionMap;
}

function getExportMap(path: string): ExportConditionMap {
  const entry = packageJson.exports?.[path];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`Expected package export "${path}" to be an object.`);
  }

  return entry as ExportConditionMap;
}

describe("package exports runtime conditions", () => {
  it("routes Bun and Deno root imports to the universal build", () => {
    const rootExport = getExportMap(".");

    expect(rootExport.bun).toEqual({
      import: "./dist/universal/index.mjs",
      default: "./dist/universal/index.mjs",
    });
    expect(rootExport.deno).toEqual({
      import: "./dist/universal/index.mjs",
      default: "./dist/universal/index.mjs",
    });
    expect(rootExport.node).toEqual({
      types: "./dist/types/node/index.d.ts",
      import: "./dist/node/node.mjs",
      require: "./dist/node/node.cjs",
    });
  });

  it("keeps ./node as the explicit Node-compat opt-in for Bun and Deno", () => {
    const nodeExport = getExportMap("./node");

    expect(nodeExport.bun).toEqual({
      import: "./dist/node/node.mjs",
      default: "./dist/node/node.mjs",
    });
    expect(nodeExport.deno).toEqual({
      import: "./dist/node/node.mjs",
      default: "./dist/node/node.mjs",
    });
    expect(nodeExport.import).toBe("./dist/node/node.mjs");
    expect(nodeExport.require).toBe("./dist/node/node.cjs");
  });
});
