import {
  symbolAsyncContext,
  symbolDefinitionIdentity,
  symbolError,
  symbolEvent,
  symbolEventLane,
  symbolHook,
  symbolMiddlewareConfiguredFrom,
  symbolResource,
  symbolRpcLane,
  symbolResourceWithConfig,
  symbolResourceMiddleware,
  symbolTag,
  symbolTagConfiguredFrom,
  symbolTask,
  symbolTaskMiddleware,
} from "../types/symbols";

type DefinitionIdentityCarrier = {
  id?: unknown;
  resource?: unknown;
  [symbolDefinitionIdentity]?: object;
  [symbolMiddlewareConfiguredFrom]?: unknown;
  [symbolResourceWithConfig]?: true;
  [symbolTagConfiguredFrom]?: unknown;
};

function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function unwrapDefinitionReference(value: unknown): unknown {
  let current: unknown = value;
  const visited = new Set<object>();

  while (isObjectLike(current) && !visited.has(current)) {
    visited.add(current);

    const carrier = current as DefinitionIdentityCarrier;
    if (carrier[symbolResourceWithConfig] === true) {
      current = carrier.resource;
      continue;
    }

    const lineage =
      carrier[symbolMiddlewareConfiguredFrom] ??
      carrier[symbolTagConfiguredFrom];
    if (!isObjectLike(lineage)) {
      break;
    }

    current = lineage;
  }

  return current;
}

function hasRunnerDefinitionMetadata(value: object): boolean {
  const carrier = value as Record<PropertyKey, unknown>;
  return (
    carrier[symbolDefinitionIdentity] !== undefined ||
    carrier[symbolTask] === true ||
    carrier[symbolResource] === true ||
    carrier[symbolResourceWithConfig] === true ||
    carrier[symbolEvent] === true ||
    carrier[symbolEventLane] === true ||
    carrier[symbolRpcLane] === true ||
    carrier[symbolHook] === true ||
    carrier[symbolTaskMiddleware] === true ||
    carrier[symbolResourceMiddleware] === true ||
    carrier[symbolTag] === true ||
    carrier[symbolError] === true ||
    carrier[symbolAsyncContext] === true ||
    carrier[symbolMiddlewareConfiguredFrom] !== undefined ||
    carrier[symbolTagConfiguredFrom] !== undefined
  );
}

export function getDefinitionIdentity(value: unknown): object | undefined {
  const unwrapped = unwrapDefinitionReference(value);
  if (!isObjectLike(unwrapped)) {
    return undefined;
  }

  const directIdentity = (unwrapped as DefinitionIdentityCarrier)[
    symbolDefinitionIdentity
  ];
  if (typeof directIdentity === "object" && directIdentity !== null) {
    return directIdentity;
  }

  return undefined;
}

export function hasDefinitionIdentity(value: unknown): boolean {
  return getDefinitionIdentity(value) !== undefined;
}

/**
 * Compare two Runner definitions by stable lineage identity when available.
 * Falls back to raw id matching only for plain, identity-less objects.
 */
export function isSameDefinition(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  const normalizedLeft = unwrapDefinitionReference(left);
  const normalizedRight = unwrapDefinitionReference(right);
  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const leftIdentity = getDefinitionIdentity(normalizedLeft);
  const rightIdentity = getDefinitionIdentity(normalizedRight);

  if (leftIdentity || rightIdentity) {
    return leftIdentity !== undefined && leftIdentity === rightIdentity;
  }

  if (!isObjectLike(normalizedLeft) || !isObjectLike(normalizedRight)) {
    return false;
  }

  if (
    (isObjectLike(left) && hasRunnerDefinitionMetadata(left)) ||
    (isObjectLike(right) && hasRunnerDefinitionMetadata(right)) ||
    hasRunnerDefinitionMetadata(normalizedLeft) ||
    hasRunnerDefinitionMetadata(normalizedRight)
  ) {
    return false;
  }

  const leftId = (normalizedLeft as DefinitionIdentityCarrier).id;
  const rightId = (normalizedRight as DefinitionIdentityCarrier).id;

  return typeof leftId === "string" && leftId === rightId;
}
