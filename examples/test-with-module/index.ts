import { r, run } from "@bluelibs/runner";

const greet = r
  .task<string>("greet")
  .dependencies({ logger: r.runner.logger })
  .run(async (name, { logger }) => {
    await logger.info(`Greeting ${name}`);
    return `Hello, ${name}!`;
  })
  .build();

const runtimeInfo = r
  .resource("runtimeInfo")
  .dependencies({ runtime: r.system.runtime })
  .init(async (_config, { runtime }) => runtime.getRootId())
  .build();

const app = r.resource("app").register([greet, runtimeInfo]).build();

async function main() {
  const runtime = await run(app);

  try {
    const greeting = await runtime.runTask(greet, "Runner");
    const rootId = await runtime.getResourceValue(runtimeInfo);

    console.log({ greeting, rootId });
  } finally {
    await runtime.dispose();
  }
}

main().catch((error) => {
  console.error(error);
});
