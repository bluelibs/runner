import type { RegisterableItem, IsolationSubtreeFilter } from "../defs";

/**
 * The four interaction channels that `scope()` controls.
 *
 * - **dependencies** — using something as a dependency (includes task execution, event emission via deps, tag accessor injection).
 * - **listening** — subscribing a hook to an event via `.on()`.
 * - **tagging** — annotating a definition with `.tags([tag])`.
 * - **middleware** — attaching middleware via `.middleware([mw])` or subtree middleware.
 */
export type IsolationChannels = {
  /** Block dependency wiring, task execution, event emission, tag accessor injection. */
  dependencies?: boolean;
  /** Block hook `.on(event)` subscriptions. */
  listening?: boolean;
  /** Block `.tags([tag])` annotations on definitions. */
  tagging?: boolean;
  /** Block `.middleware([mw])` attachments (task + resource middleware). */
  middleware?: boolean;
};

/** All four channel names as a union type. */
export type IsolationChannel =
  | "dependencies"
  | "listening"
  | "tagging"
  | "middleware";

export const ISOLATION_WILDCARD = "*" as const;
export type IsolationWildcard = typeof ISOLATION_WILDCARD;

/**
 * The set of target types that scope() accepts.
 *
 * String selectors are only valid inside scope(), where they resolve against
 * registered canonical ids. Use `"*"` for a full wildcard or patterns such as
 * `"system.*"` / `"app.resources.*"` for segment-based matches.
 */
export type IsolationScopeTarget =
  | RegisterableItem
  | IsolationSubtreeFilter
  | IsolationWildcard
  | string;

/**
 * A scope entry created by `scope()`.
 *
 * Wraps one or more isolation targets with channel-level precision,
 * controlling **which interaction types** the deny/only rule applies to.
 */
export interface IsolationScope {
  /** Discriminant — lets type guards identify scope entries at runtime. */
  readonly _isolationScope: true;
  /** The targets this scope covers. */
  readonly targets: ReadonlyArray<IsolationScopeTarget>;
  /** Resolved channel flags — all four are always present after normalisation. */
  readonly channels: Readonly<Required<IsolationChannels>>;
}

const ALL_CHANNELS_ON: Readonly<Required<IsolationChannels>> = Object.freeze({
  dependencies: true,
  listening: true,
  tagging: true,
  middleware: true,
});

/**
 * Creates a scoped isolation entry with channel-level precision.
 *
 * When used inside `.isolate({ deny: [...] })` or `.isolate({ only: [...] })`,
 * controls *which* interaction types the rule applies to. Channels default to
 * `true` (all blocked) — pass `false` to opt-out of specific channels.
 *
 * @example
 * ```ts
 * import { r, scope, subtreeOf } from "@bluelibs/runner";
 *
 * const app = r.resource("app")
 *   .isolate({
 *     deny: [
 *       scope(dangerousTask),                                     // block all channels
 *       scope(userCreated, { listening: false }),                  // block emit, allow listen
 *       scope([subtreeOf(lib), subtreeOf(agent)], { tagging: false }), // block deps/listen/mw
 *       scope(subtreeOf(internalModule), { dependencies: false }), // block listen/tag/mw only
 *     ],
 *   })
 *   .build();
 * ```
 */
export function scope(
  target: IsolationScopeTarget | ReadonlyArray<IsolationScopeTarget>,
  channels?: IsolationChannels,
): IsolationScope {
  const targets: ReadonlyArray<IsolationScopeTarget> = Array.isArray(target)
    ? Object.freeze([...target])
    : Object.freeze([target]);

  const resolved: Readonly<Required<IsolationChannels>> = channels
    ? Object.freeze({
        dependencies: channels.dependencies ?? true,
        listening: channels.listening ?? true,
        tagging: channels.tagging ?? true,
        middleware: channels.middleware ?? true,
      })
    : ALL_CHANNELS_ON;

  return Object.freeze({
    _isolationScope: true as const,
    targets,
    channels: resolved,
  });
}
