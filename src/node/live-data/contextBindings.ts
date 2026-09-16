import { storage } from "../../definers/defineAsyncContext";
import type { IAsyncContext } from "../../defs";
import type { Store } from "../../models/store/Store";
import type { SerializerLike } from "../../serializer";
import { cloneLiveValue } from "./serialization";
import type { LiveQuery } from "./types";

export interface ContextBinding {
  context: IAsyncContext<any>;
  canonicalId: string;
  present: boolean;
  value?: unknown;
}

export function captureContextBindings(
  query: LiveQuery,
  identityContext: IAsyncContext<any>,
  store: Store,
  serializer: SerializerLike,
): readonly ContextBinding[] {
  const contexts = [identityContext, ...query.asyncContexts];
  const unique = new Set<IAsyncContext<any>>();
  const bindings: ContextBinding[] = [];
  for (const context of contexts) {
    if (unique.has(context)) continue;
    unique.add(context);
    const present = context.has();
    bindings.push({
      context,
      canonicalId: store.findIdByDefinition(context),
      present,
      value: present ? cloneLiveValue(context.use(), serializer) : undefined,
    });
  }
  return bindings;
}

export function withContextBindings<T>(
  bindings: readonly ContextBinding[],
  serializer: SerializerLike,
  operation: () => Promise<T> | T,
): Promise<T> | T {
  const provide = (index: number): Promise<T> | T => {
    const binding = bindings[index];
    if (!binding) return operation();
    if (!binding.present) return provide(index + 1);
    return binding.context.provide(
      cloneLiveValue(binding.value, serializer),
      () => provide(index + 1),
    );
  };
  return storage.run(new Map(), () => provide(0));
}
