import { createRequire } from "node:module";
import { join } from "node:path";

type AmqplibModule = {
  connect: (url: string) => Promise<unknown>;
};

let cachedAmqplib: AmqplibModule | null = null;

function getAmqplib(): AmqplibModule {
  if (cachedAmqplib) return cachedAmqplib;

  const requireFn = createRequire(join(process.cwd(), "__runner_require__.js"));

  try {
    const mod = requireFn("amqplib") as unknown;
    if (!mod || typeof mod !== "object") {
      throw new Error("Invalid 'amqplib' export");
    }
    const connect = (mod as { connect?: unknown }).connect;
    if (typeof connect !== "function") {
      throw new Error("Invalid 'amqplib.connect' export");
    }
    cachedAmqplib = { connect: connect as AmqplibModule["connect"] };
    return cachedAmqplib;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing optional dependency 'amqplib'. Install it to use RabbitMQQueue. Original error: ${message}`,
    );
  }
}

export async function connectAmqplib(url: string): Promise<unknown> {
  const { connect } = getAmqplib();
  return await connect(url);
}
