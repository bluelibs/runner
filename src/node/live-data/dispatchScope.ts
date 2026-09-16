import { AsyncResource } from "node:async_hooks";

export function createLiveDispatchScope() {
  const resource = new AsyncResource("runner.liveData.dispatch");

  return {
    run<T>(operation: () => T): T {
      return resource.runInAsyncScope(operation);
    },
    dispose(): void {
      resource.emitDestroy();
    },
  };
}
