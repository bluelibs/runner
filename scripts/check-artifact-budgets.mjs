#!/usr/bin/env node
import fs from "node:fs";

const BUDGET_PATH = new URL(
  "../config/benchmarks/artifact-budgets.json",
  import.meta.url,
);
const ROOT_URL = new URL("../", import.meta.url);

const budgets = JSON.parse(fs.readFileSync(BUDGET_PATH, "utf8"));
const failures = [];

for (const [relativePath, maximumBytes] of Object.entries(budgets)) {
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) {
    failures.push(
      `${relativePath}: budget must be a positive integer, received ${String(maximumBytes)}`,
    );
    continue;
  }

  const artifactUrl = new URL(relativePath, ROOT_URL);
  if (!fs.existsSync(artifactUrl)) {
    failures.push(`${relativePath}: artifact is missing; run npm run build first`);
    continue;
  }

  const actualBytes = fs.statSync(artifactUrl).size;
  const utilization = ((actualBytes / maximumBytes) * 100).toFixed(1);
  console.log(
    `${relativePath}: ${actualBytes} / ${maximumBytes} bytes (${utilization}% of budget)`,
  );

  if (actualBytes > maximumBytes) {
    failures.push(
      `${relativePath}: ${actualBytes} bytes exceeds ${maximumBytes}-byte budget`,
    );
  }
}

if (failures.length > 0) {
  console.error("\nArtifact budget failures:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
