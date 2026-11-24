import type { SerializerLike } from "../../serializer";

type RequestKind = "task" | "event" | "eventWithResult";

interface InternalRequestMetadata {
  kind: RequestKind;
  id: string;
  payload: unknown;
  serialized?: { serializer: SerializerLike; body: string };
  hasNodeFile?: boolean;
}

// Options are owned by one call. Weak keys keep internal hints off the public
// request object and let them be collected when that call finishes.
const metadataByOptions = new WeakMap<object, InternalRequestMetadata>();

export function defineInternalRequestMetadata(
  options: object,
  metadata: InternalRequestMetadata,
): void {
  metadataByOptions.set(options, metadata);
}

export function readInternalRequestMetadata(
  options: object | undefined,
  kind: RequestKind,
  id: string,
  payload: unknown,
): InternalRequestMetadata | undefined {
  if (!options) return undefined;
  const metadata = metadataByOptions.get(options);
  if (
    metadata?.kind === kind &&
    metadata.id === id &&
    Object.is(metadata.payload, payload)
  ) {
    return metadata;
  }
  return undefined;
}

/** Use the signed JSON only when the HTTP client uses the same serializer. */
export function readPreSerializedBody(
  metadata: InternalRequestMetadata | undefined,
  serializer: SerializerLike,
): string | undefined {
  const serialized = metadata?.serialized;
  return serialized?.serializer === serializer ? serialized.body : undefined;
}

export function copyInternalRequestMetadata(
  source: object,
  target: object,
): void {
  const metadata = metadataByOptions.get(source);
  if (metadata) metadataByOptions.set(target, metadata);
}
