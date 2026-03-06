/**
 * Internal brand symbols used to tag created objects at runtime and help with
 * type‑narrowing. Prefer the `isTask`/`isResource`/`isEvent`/`isMiddleware`
 * helpers instead of touching these directly.
 * @internal
 */
export const symbolTask: unique symbol = Symbol.for("runner.task");
export const symbolResource: unique symbol = Symbol.for("runner.resource");
/** @internal Generic fork provenance metadata for definitions that support `.fork()` */
export const symbolForkedFrom: unique symbol = Symbol.for("runner.forkedFrom");
export const symbolResourceWithConfig: unique symbol = Symbol.for(
  "runner.resourceWithConfig",
);
/** @internal Marks override definitions produced via the override builder API. */
export const symbolOverrideDefinition: unique symbol = Symbol.for(
  "runner.overrideDefinition",
);
/**
 * @internal Stores the original definition reference that an override targets.
 * This allows runtime systems to resolve the canonical, run-scoped id.
 */
export const symbolOverrideTargetDefinition: unique symbol = Symbol.for(
  "runner.overrideTargetDefinition",
);
export const symbolEvent: unique symbol = Symbol.for("runner.event");
export const symbolEventLane: unique symbol = Symbol.for("runner.eventLane");
export const symbolRpcLane: unique symbol = Symbol.for("runner.rpcLane");
/** @internal Marks an error helper definition */
export const symbolError: unique symbol = Symbol.for("runner.error");
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
/** @internal Points a configured middleware instance to its source definition. */
export const symbolMiddlewareConfiguredFrom: unique symbol = Symbol.for(
  "runner.middlewareConfiguredFrom",
);
/** Records which rpc-lanes resource owns the task routing patch (exclusivity). */
export const symbolRpcLaneRoutedBy: unique symbol = Symbol.for(
  "runner.rpcLaneRoutedBy",
);
/** Stores the resolved rpc lane policy on routed task definitions. */
export const symbolRpcLanePolicy: unique symbol = Symbol.for(
  "runner.rpcLanePolicy",
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
/** @internal Points a configured tag instance to its source definition. */
export const symbolTagConfiguredFrom: unique symbol = Symbol.for(
  "runner.tagConfiguredFrom",
);
/** @internal Marks a tag before-init dependency wrapper */
export const symbolTagBeforeInitDependency: unique symbol = Symbol.for(
  "runner.tagBeforeInitDependency",
);

/** @internal Marks an optional dependency wrapper */
export const symbolOptionalDependency: unique symbol = Symbol.for(
  "runner.optionalDependency",
);

/** @internal Path to aid anonymous id generation and error messages */
export const symbolFilePath: unique symbol = Symbol.for("runner.filePath");

/** @internal Marks an async context definition */
export const symbolAsyncContext: unique symbol = Symbol.for(
  "runner.asyncContext",
);

/** @internal Preserves the original resource reference captured by subtreeOf(). */
export const symbolIsolationSubtreeResource: unique symbol = Symbol.for(
  "runner.isolationSubtreeResource",
);
