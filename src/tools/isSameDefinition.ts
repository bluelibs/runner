import {
  symbolDefinitionIdentity,
  symbolTagConfiguredFrom,
} from "../types/symbols";

type DefinitionIdentityCarrier = {
  id?: unknown;
  [symbolDefinitionIdentity]?: object;
  [symbolTagConfiguredFrom]?: unknown;
};

function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function getDefinitionIdentity(value: unknown): object | undefined {
  if (!isObjectLike(value)) {
    return undefined;
  }

  const directIdentity = (value as DefinitionIdentityCarrier)[
    symbolDefinitionIdentity
  ];
  if (typeof directIdentity === "object" && directIdentity !== null) {
    return directIdentity;
  }

  const configuredFrom = (value as DefinitionIdentityCarrier)[
    symbolTagConfiguredFrom
  ];
  if (!isObjectLike(configuredFrom)) {
    return undefined;
  }

  const configuredFromIdentity = (configuredFrom as DefinitionIdentityCarrier)[
    symbolDefinitionIdentity
  ];
  if (
    typeof configuredFromIdentity === "object" &&
    configuredFromIdentity !== null
  ) {
    return configuredFromIdentity;
  }

  return undefined;
}

/**
 * Compare two Runner definitions by stable lineage identity when available.
 * Falls back to raw id matching only for plain, identity-less objects.
 */
export function isSameDefinition(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  const leftIdentity = getDefinitionIdentity(left);
  const rightIdentity = getDefinitionIdentity(right);

  if (leftIdentity || rightIdentity) {
    return leftIdentity !== undefined && leftIdentity === rightIdentity;
  }

  if (!isObjectLike(left) || !isObjectLike(right)) {
    return false;
  }

  const leftId = (left as DefinitionIdentityCarrier).id;
  const rightId = (right as DefinitionIdentityCarrier).id;

  return typeof leftId === "string" && leftId === rightId;
}
