import type { IAsyncContext } from "../../defs";
import type { SerializerLike } from "../../serializer";

type AsyncContextRef = IAsyncContext<unknown> | string;

function toAsyncContextId(value: AsyncContextRef): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    (value as { id: string }).id.length > 0
  ) {
    return (value as { id: string }).id;
  }

  return undefined;
}

export function resolveLaneAsyncContextAllowList(options: {
  laneAsyncContexts?: readonly AsyncContextRef[];
  legacyAllowAsyncContext?: boolean;
}): readonly string[] | undefined {
  const { laneAsyncContexts, legacyAllowAsyncContext } = options;

  if (!laneAsyncContexts) {
    return legacyAllowAsyncContext === true ? undefined : [];
  }

  const ids = new Set<string>();
  for (const entry of laneAsyncContexts) {
    const id = toAsyncContextId(entry);
    if (id) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

export function resolveLaneAsyncContextPolicy(options: {
  laneAsyncContexts?: readonly AsyncContextRef[];
  legacyAllowAsyncContext?: boolean;
}): {
  allowList: readonly string[] | undefined;
  allowAsyncContext: boolean;
} {
  const allowList = resolveLaneAsyncContextAllowList(options);

  return {
    allowList,
    allowAsyncContext: allowList === undefined || allowList.length > 0,
  };
}

export function resolveRegistryAsyncContextIds(
  registry: ReadonlyMap<string, IAsyncContext<unknown>>,
  allowList: readonly string[] | undefined,
): readonly string[] | undefined {
  if (allowList === undefined) {
    return undefined;
  }

  const registeredIds = Array.from(registry.keys());
  const resolvedIds = new Set<string>();

  for (const requestedId of allowList) {
    if (registeredIds.includes(requestedId)) {
      resolvedIds.add(requestedId);
      continue;
    }

    const resolvedContext = registry.get(requestedId);
    if (resolvedContext) {
      const resolvedRegistryId = registeredIds.find(
        (registeredId) => registry.get(registeredId) === resolvedContext,
      );
      if (resolvedRegistryId) {
        resolvedIds.add(resolvedRegistryId);
        continue;
      }
    }

    resolvedIds.add(requestedId);
  }

  return Array.from(resolvedIds);
}

export function buildAsyncContextHeader(options: {
  allowList: readonly string[] | undefined;
  registry: ReadonlyMap<string, IAsyncContext<unknown>>;
  serializer: SerializerLike;
}): string | undefined {
  const { registry, serializer } = options;
  const allowList = resolveRegistryAsyncContextIds(registry, options.allowList);
  const map: Record<string, string> = {};

  const collect = (id: string) => {
    const asyncContext = registry.get(id);
    if (!asyncContext) {
      return;
    }

    try {
      const serialized = asyncContext.serialize(asyncContext.use());
      // Always include canonical id for strict hydration on receivers.
      map[asyncContext.id] = serialized;
      // Preserve requested/public id when it differs for compatibility.
      if (id !== asyncContext.id) {
        map[id] = serialized;
      }
    } catch {
      // Context missing/unavailable in current call scope.
    }
  };

  if (!allowList) {
    for (const id of registry.keys()) {
      collect(id);
    }
  } else {
    for (const id of allowList) {
      collect(id);
    }
  }

  return Object.keys(map).length > 0 ? serializer.stringify(map) : undefined;
}

export async function withSerializedAsyncContexts<T>(options: {
  serializedContexts?: string;
  registry: ReadonlyMap<string, IAsyncContext<unknown>>;
  serializer: SerializerLike;
  fn: () => Promise<T>;
  allowAsyncContext?: boolean;
  allowedAsyncContextIds?: readonly string[];
}): Promise<T> {
  const {
    serializedContexts,
    registry,
    serializer,
    fn,
    allowAsyncContext = true,
    allowedAsyncContextIds,
  } = options;

  if (!allowAsyncContext || !serializedContexts) {
    return fn();
  }

  const allowedIds =
    allowedAsyncContextIds === undefined
      ? undefined
      : new Set(
          resolveRegistryAsyncContextIds(registry, allowedAsyncContextIds),
        );

  let wrapped = fn;

  try {
    const map = serializer.parse<Record<string, string>>(serializedContexts);
    for (const [id, context] of registry.entries()) {
      if (allowedIds && !allowedIds.has(id)) {
        continue;
      }

      const raw = map[id];
      if (typeof raw !== "string") {
        continue;
      }

      try {
        const value = context.parse(raw);
        const previous = wrapped;
        wrapped = async () => await context.provide(value, previous);
      } catch {
        // Ignore per-context hydration failures so one bad context does not
        // block the rest of the lane/request execution.
      }
    }
  } catch {
    // Ignore malformed serialized context payloads.
  }

  return wrapped();
}
