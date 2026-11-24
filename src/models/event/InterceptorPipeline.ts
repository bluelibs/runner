import type { HookExecutionInterceptor, HookExecutor } from "./types";

/** Composes hook interceptors in registration order. */
export function composeHookInterceptors(
  interceptors: readonly HookExecutionInterceptor[],
): HookExecutor {
  return interceptors.reduceRight<HookExecutor>(
    (next, interceptor) => (hook, event, dependencies) =>
      interceptor(
        (nextHook, nextEvent) => next(nextHook, nextEvent, dependencies),
        hook,
        event,
      ),
    async (hook, event, dependencies) => hook.run(event, dependencies),
  );
}
