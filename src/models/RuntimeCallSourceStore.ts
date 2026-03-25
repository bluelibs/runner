import { getPlatform, type IAsyncLocalStorage } from "../platform";
import type { RuntimeCallSource } from "../types/runtimeSource";

let sharedStore: IAsyncLocalStorage<RuntimeCallSource | null> | undefined;
let sharedStorePlatform: ReturnType<typeof getPlatform> | undefined;

function getSharedRuntimeCallSourceStore(): IAsyncLocalStorage<RuntimeCallSource | null> | null {
  const platform = getPlatform();
  if (sharedStorePlatform !== platform) {
    sharedStorePlatform = platform;
    sharedStore = undefined;
  }

  if (sharedStore) {
    return sharedStore;
  }

  if (!platform.hasAsyncLocalStorage()) {
    return null;
  }

  sharedStore = platform.createAsyncLocalStorage<RuntimeCallSource | null>();
  return sharedStore;
}

export function getCurrentRuntimeCallSource(): RuntimeCallSource | undefined {
  return getSharedRuntimeCallSourceStore()?.getStore() ?? undefined;
}

export function runWithRuntimeCallSource<T>(
  source: RuntimeCallSource,
  fn: () => T,
): T {
  const store = getSharedRuntimeCallSourceStore();
  if (!store) {
    return fn();
  }

  return store.run(source, fn);
}
