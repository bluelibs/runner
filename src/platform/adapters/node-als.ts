// Isolated loader for Node's AsyncLocalStorage to avoid leaking node: imports into non-node builds
export async function loadAsyncLocalStorageClass() {
  const mod = await import("node:async_hooks");
  return (mod as any).AsyncLocalStorage;
}
