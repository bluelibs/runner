import { symbolRuntimeId } from "../types/symbols";

type RuntimeMetadataCarrier = {
  id?: unknown;
  path?: unknown;
  [symbolRuntimeId]?: unknown;
};

function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

export function getRuntimeId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (!isObjectLike(value)) {
    return undefined;
  }

  const runtimeId = (value as RuntimeMetadataCarrier)[symbolRuntimeId];
  return typeof runtimeId === "string" && runtimeId.length > 0
    ? runtimeId
    : undefined;
}

export function hasRuntimeId(value: unknown): boolean {
  return getRuntimeId(value) !== undefined;
}

export function getRuntimePath(value: unknown): string | undefined {
  if (!isObjectLike(value)) {
    return getRuntimeId(value);
  }

  const path = (value as RuntimeMetadataCarrier).path;
  if (typeof path === "string" && path.length > 0) {
    return path;
  }

  return getRuntimeId(value);
}
