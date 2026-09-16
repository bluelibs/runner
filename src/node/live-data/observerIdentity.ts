import type { SerializerLike } from "../../serializer";

interface SharedObserverIdentity {
  queryId: number;
  taskId: string;
  rawInput: unknown;
  normalizedInput: unknown;
  contextValues: readonly unknown[];
  topicKeys: readonly string[];
}

export function createSharedObserverKey(
  serializer: SerializerLike,
  identity: SharedObserverIdentity,
): string {
  const serialized = serializer.stringify(identity);
  return `shared:${identity.queryId}:${identity.taskId}:${serialized}`;
}
