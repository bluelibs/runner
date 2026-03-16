interface EnvReaderGlobal extends Record<string, unknown> {
  __ENV__?: Record<string, string | undefined> | null;
  env?: Record<string, string | undefined> | null;
  process?: { env?: Record<string, string | undefined> };
  Bun?: { env?: Record<string, string | undefined> };
  Deno?: {
    env?: {
      get?: (key: string) => string | undefined;
    };
  };
}

function readObjectEnv(
  source: Record<string, string | undefined> | null | undefined,
  key: string,
): string | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  return source[key];
}

export function readEnvironmentVariable(key: string): string | undefined {
  const globalScope = globalThis as EnvReaderGlobal;

  const injectedEnv = readObjectEnv(globalScope.__ENV__, key);
  if (injectedEnv !== undefined) {
    return injectedEnv;
  }

  const denoEnv = globalScope.Deno?.env;
  if (denoEnv && typeof denoEnv.get === "function") {
    const denoValue = denoEnv.get(key);
    if (denoValue !== undefined) {
      return denoValue;
    }
  }

  const bunEnv = readObjectEnv(globalScope.Bun?.env, key);
  if (bunEnv !== undefined) {
    return bunEnv;
  }

  const processEnv = readObjectEnv(globalScope.process?.env, key);
  if (processEnv !== undefined) {
    return processEnv;
  }

  return readObjectEnv(globalScope.env, key);
}
