#!/usr/bin/env node
import { build } from "esbuild";

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

for (const consumer of consumers) {
  await build({
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
  console.log(`${consumer.id}: consumer bundle passed`);
}
