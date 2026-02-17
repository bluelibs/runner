import { createRequire } from "node:module";
import { join } from "node:path";
import {
  optionalDependencyInvalidExportError,
  optionalDependencyMissingError,
} from "../../../errors";

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
      optionalDependencyInvalidExportError.throw({
        dependency: "amqplib",
        details: "",
      });
    }
    const connect = (mod as { connect?: unknown }).connect;
    if (typeof connect !== "function") {
      optionalDependencyInvalidExportError.throw({
        dependency: "amqplib",
        details: ".connect",
      });
    }
    cachedAmqplib = { connect: connect as AmqplibModule["connect"] };
    return cachedAmqplib;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return optionalDependencyMissingError.throw({
      dependency: "amqplib",
      details: ` Install it to use RabbitMQQueue. Original error: ${message}`,
    });
  }
}

export async function connectAmqplib(url: string): Promise<unknown> {
  const { connect } = getAmqplib();
  return await connect(url);
}
