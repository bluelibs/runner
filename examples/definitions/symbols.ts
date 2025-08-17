/**
 * Internal brand symbols used to tag created objects at runtime and help with
 * type‑narrowing. Prefer the `isTask`/`isResource`/`isEvent`/`isMiddleware`
 * helpers instead of touching these directly.
 * @internal
 */
export const symbolTask: unique symbol = Symbol("runner.task");
export const symbolResource: unique symbol = Symbol("runner.resource");
export const symbolResourceWithConfig: unique symbol = Symbol(
  "runner.resourceWithConfig"
);
export const symbolEvent: unique symbol = Symbol("runner.event");
export const symbolMiddleware: unique symbol = Symbol("runner.middleware");
export const symbolMiddlewareConfigured: unique symbol = Symbol(
  "runner.middlewareConfigured"
);
/** @internal Marks hook definitions (event listeners without middleware) */
export const symbolHook: unique symbol = Symbol("runner.hook");
export const symbolMiddlewareGlobal: unique symbol = Symbol(
  "runner.middlewareGlobal"
);
export const symbolMiddlewareEverywhereTasks: unique symbol = Symbol(
  "runner.middlewareGlobalTasks"
);
export const symbolMiddlewareEverywhereResources: unique symbol = Symbol(
  "runner.middlewareGlobalResources"
);

/** @internal Marks an optional dependency wrapper */
export const symbolOptionalDependency: unique symbol = Symbol(
  "runner.optionalDependency"
);

/** @internal Path to aid anonymous id generation and error messages */
export const symbolFilePath: unique symbol = Symbol("runner.filePath");
/** @internal Marks disposable instances */
export const symbolDispose: unique symbol = Symbol("runner.dispose");
/** @internal Link to internal Store */
export const symbolStore: unique symbol = Symbol("runner.store");

/** @internal Brand used by index() resources */
export const symbolIndexResource: unique symbol = Symbol(
  "runner.indexResource"
);
