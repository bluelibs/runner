import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(
  new URL("../compare-benchmarks.mjs", import.meta.url),
);

function compare(base, current, config = {}) {
  const directory = mkdtempSync(join(tmpdir(), "runner-benchmark-test-"));
  try {
    const inputs = [
      { results: { rate: base } },
      { meta: { isCI: true }, results: { rate: current } },
      { threshold: 0.1, metrics: { rate: "higher" }, ...config },
    ];
    const paths = inputs.map((input, index) => {
      const path = join(directory, `${index}.json`);
      writeFileSync(path, JSON.stringify(input));
      return path;
    });
    return spawnSync(process.execPath, [script, ...paths], {
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("fails a CI regression as soon as the configured threshold is exceeded", () => {
  assert.equal(compare(100, 89).status, 1);
  assert.equal(compare(100, 90).status, 0);
  assert.equal(compare(100, 111, { metrics: { rate: "lower" } }).status, 1);
});

test("fails on missing, non-numeric, or negative tracked metrics", () => {
  for (const invalid of [undefined, null, "100", -1, Infinity]) {
    assert.equal(compare(invalid, 100).status, 1);
    assert.equal(compare(100, invalid).status, 1);
  }
});

test("does not relax the threshold when statistical result format changes", () => {
  assert.equal(compare(100, { median: 80, min: 79, max: 81 }).status, 1);
  assert.equal(compare({ median: 100 }, 100).status, 0);
});

test("honors zero thresholds at every override level", () => {
  assert.equal(compare(100, 99, { threshold: 0 }).status, 1);
  assert.equal(compare(100, 99, { ciThreshold: 0 }).status, 1);
  assert.equal(compare(100, 99, { metricThresholds: { rate: 0 } }).status, 1);
});

test("fails invalid config instead of silently skipping checks", () => {
  assert.equal(compare(100, 100, { metrics: {} }).status, 1);
  assert.equal(compare(100, 100, { metrics: { rate: "unknown" } }).status, 1);
  assert.equal(compare(100, 100, { threshold: -1 }).status, 1);
});
