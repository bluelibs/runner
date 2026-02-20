import { createRequire } from "node:module";
import { join } from "node:path";
import {
  optionalDependencyInvalidExportError,
  optionalDependencyMissingError,
} from "../../../errors";

type RedisConstructor = new (...args: unknown[]) => unknown;

let cachedRedisConstructor: RedisConstructor | null = null;

function getRedisConstructor(): RedisConstructor {
  if (cachedRedisConstructor) return cachedRedisConstructor;

  const requireFn = createRequire(join(process.cwd(), "__runner_require__.js"));

  try {
    const mod = requireFn("ioredis") as unknown;
    const candidate =
      typeof mod === "object" && mod !== null && "default" in mod
        ? (mod as { default: unknown }).default
        : mod;

    if (typeof candidate !== "function") {
      optionalDependencyInvalidExportError.throw({
        dependency: "ioredis",
        details: "",
      });
    }

    cachedRedisConstructor = candidate as RedisConstructor;
    return cachedRedisConstructor;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return optionalDependencyMissingError.throw({
      dependency: "ioredis",
      details: ` Install it or pass an explicit redis client instance. Original error: ${message}`,
    });
  }
}

export function createIORedisClient(url?: string): unknown {
  const Redis = getRedisConstructor();
  return url ? new Redis(url) : new Redis();
}
