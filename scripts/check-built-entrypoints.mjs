#!/usr/bin/env node
import assert from "node:assert/strict";

const entrypoints = [
  ["universal", "../dist/universal/index.mjs", ["r", "run"]],
  ["node", "../dist/node/node.mjs", ["r", "run", "durableResource", "live"]],
  [
    "decorators/es",
    "../dist/universal/decorators/es.mjs",
    ["Match", "Serializer", "check"],
  ],
  [
    "decorators/legacy",
    "../dist/universal/decorators/legacy.mjs",
    ["Match", "Serializer", "check"],
  ],
];

for (const [name, relativePath, expectedExports] of entrypoints) {
  const module = await import(new URL(relativePath, import.meta.url));
  for (const expectedExport of expectedExports) {
    assert.ok(
      expectedExport in module,
      `${name} is missing runtime export ${expectedExport}`,
    );
  }
  if (name === "node") {
    for (const resource of [
      "liveData",
      "liveDataProvider",
      "redisLiveDataProvider",
    ]) {
      assert.ok(
        resource in module.resources,
        `node is missing resource ${resource}`,
      );
    }
  } else if (name === "universal") {
    assert.ok(
      !("live" in module),
      "universal must not export Node live-data APIs",
    );
    assert.ok(
      !("liveData" in module.resources),
      "universal must not register live data",
    );
  }
  console.log(`${name}: standalone import passed`);
}
