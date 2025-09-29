// Isolated loader for Node's AsyncLocalStorage to avoid leaking node: imports into non-node builds
export async function loadAsyncLocalStorageClass() {
  // Use require for Jest/Node compatibility - this file is Node-specific anyway
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("node:async_hooks");
  return (mod as any).AsyncLocalStorage;
}
