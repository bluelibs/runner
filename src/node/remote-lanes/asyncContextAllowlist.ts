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

export function buildAsyncContextHeader(options: {
  allowList: readonly string[] | undefined;
  registry: ReadonlyMap<string, IAsyncContext<unknown>>;
  serializer: SerializerLike;
}): string | undefined {
  const { allowList, registry, serializer } = options;
  const map: Record<string, string> = {};

  const collect = (id: string) => {
    const ctx = registry.get(id);
    if (!ctx) {
      return;
    }

    try {
      map[id] = ctx.serialize(ctx.use());
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
