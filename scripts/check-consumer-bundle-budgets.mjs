#!/usr/bin/env node
import fs from "node:fs";
import { build } from "esbuild";

const budgets = JSON.parse(
  fs.readFileSync(
    new URL("../config/benchmarks/consumer-bundle-budgets.json", import.meta.url),
    "utf8",
  ),
);

const consumers = [
  {
    id: "browserCore",
    platform: "browser",
    source: `
      import { r, run } from "@bluelibs/runner";
      const task = r.task("consumer-task").run(async () => 1).build();
      const app = r.resource("consumer-app").register([task]).build();
      void run(app);
    `,
  },
  {
    id: "nodeDurable",
    platform: "node",
    source: `
      import { r, resources, run } from "@bluelibs/runner/node";
      const app = r.resource("consumer-app")
        .register([resources.memoryWorkflow])
        .build();
      void run(app);
    `,
  },
];

const failures = [];

for (const consumer of consumers) {
  const maximumBytes = budgets[consumer.id];
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) {
    failures.push(
      `${consumer.id}: budget must be a positive integer, received ${String(maximumBytes)}`,
    );
    continue;
  }

  const result = await build({
    stdin: {
      contents: consumer.source,
      loader: "ts",
      resolveDir: process.cwd(),
      sourcefile: `${consumer.id}.ts`,
    },
    bundle: true,
    external: ["async_hooks", "node:async_hooks"],
    format: "esm",
    logLevel: "silent",
    minify: true,
    platform: consumer.platform,
    target: "es2022",
    treeShaking: true,
    write: false,
  });
  const actualBytes = result.outputFiles[0].contents.byteLength;
  const utilization = ((actualBytes / maximumBytes) * 100).toFixed(1);
  console.log(
    `${consumer.id}: ${actualBytes} / ${maximumBytes} bytes (${utilization}% of budget)`,
  );

  if (actualBytes > maximumBytes) {
    failures.push(
      `${consumer.id}: ${actualBytes} bytes exceeds ${maximumBytes}-byte budget`,
    );
  }
}

if (failures.length > 0) {
  console.error("\nConsumer bundle budget failures:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
