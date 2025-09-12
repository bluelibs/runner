/**
 * Internal brand symbols used to tag created objects at runtime and help with
 * type‑narrowing. Prefer the `isTask`/`isResource`/`isEvent`/`isMiddleware`
 * helpers instead of touching these directly.
 * @internal
 */
export const symbolTask: unique symbol = Symbol.for("runner.task");
/** Marks a task as a phantom task (no-op run; meant to be tunneled/routed). */
export const symbolPhantomTask: unique symbol = Symbol.for(
  "runner.task.phantom",
);
export const symbolResource: unique symbol = Symbol.for("runner.resource");
export const symbolResourceWithConfig: unique symbol = Symbol.for(
  "runner.resourceWithConfig",
);
export const symbolEvent: unique symbol = Symbol.for("runner.event");
export const symbolMiddleware: unique symbol = Symbol.for("runner.middleware");
/** New brands for separated middleware kinds */
export const symbolTaskMiddleware: unique symbol = Symbol.for(
  "runner.taskMiddleware",
);
export const symbolResourceMiddleware: unique symbol = Symbol.for(
  "runner.resourceMiddleware",
);
export const symbolMiddlewareConfigured: unique symbol = Symbol.for(
  "runner.middlewareConfigured",
);
/** Marks a task that has been patched by a tunnel. Value is the local side mode. */
export const symbolTunneledTask: unique symbol = Symbol.for(
  "runner.tunneledTask",
);
/** @internal Marks hook definitions (event listeners without middleware) */
export const symbolHook: unique symbol = Symbol.for("runner.hook");
// export const symbolMiddlewareEverywhereTasks: unique symbol = Symbol.for(
//   "runner.middlewareGlobalTasks",
// );
// export const symbolMiddlewareEverywhereResources: unique symbol = Symbol.for(
//   "runner.middlewareGlobalResources",
// );
/** @internal Marks a tag definition */
export const symbolTag: unique symbol = Symbol.for("runner.tag");
export const symbolTagConfigured: unique symbol = Symbol.for(
  "runner.tagConfigured",
);

/** @internal Marks an optional dependency wrapper */
export const symbolOptionalDependency: unique symbol = Symbol.for(
  "runner.optionalDependency",
);

/** @internal Path to aid anonymous id generation and error messages */
export const symbolFilePath: unique symbol = Symbol.for("runner.filePath");
