#!/usr/bin/env node
import assert from "node:assert/strict";

const entrypoints = [
  ["universal", "../dist/universal/index.mjs", ["r", "run"]],
  ["node", "../dist/node/node.mjs", ["r", "run", "durableResource"]],
  ["decorators/es", "../dist/universal/decorators/es.mjs", ["Match", "Serializer", "check"]],
  ["decorators/legacy", "../dist/universal/decorators/legacy.mjs", ["Match", "Serializer", "check"]],
];

for (const [name, relativePath, expectedExports] of entrypoints) {
  const module = await import(new URL(relativePath, import.meta.url));
  for (const expectedExport of expectedExports) {
    assert.ok(
      expectedExport in module,
      `${name} is missing runtime export ${expectedExport}`,
    );
  }
  console.log(`${name}: standalone import passed`);
}
