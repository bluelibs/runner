// Isolated loader for Node's AsyncLocalStorage to avoid leaking node: imports into non-node builds
export function getBuiltinAsyncLocalStorageClass():
  | typeof import("node:async_hooks").AsyncLocalStorage
  | undefined {
  if (
    typeof process === "undefined" ||
    typeof process.getBuiltinModule !== "function"
  ) {
    return undefined;
  }

  const mod = process.getBuiltinModule("node:async_hooks") as
    | typeof import("node:async_hooks")
    | undefined;
  return mod?.AsyncLocalStorage;
}

export async function loadAsyncLocalStorageClass() {
  const builtinAsyncLocalStorage = getBuiltinAsyncLocalStorageClass();
  if (builtinAsyncLocalStorage) {
    return builtinAsyncLocalStorage;
  }

  const mod =
    (await import("node:async_hooks")) as typeof import("node:async_hooks");
  return mod.AsyncLocalStorage;
}
