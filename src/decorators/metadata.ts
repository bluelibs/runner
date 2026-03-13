type DecoratorMetadataRecord = Record<PropertyKey, unknown>;

type SymbolWithMetadata = typeof Symbol & {
  metadata?: symbol;
};

type MetadataContext = {
  metadata?: unknown;
};

function getSymbolMetadataKey(): symbol | undefined {
  return (Symbol as SymbolWithMetadata).metadata;
}

export function getDecoratorMetadataRecord(
  target: Function,
): DecoratorMetadataRecord | undefined {
  const metadataKey = getSymbolMetadataKey();
  if (metadataKey === undefined) {
    return undefined;
  }

  if (!Object.prototype.hasOwnProperty.call(target, metadataKey)) {
    return undefined;
  }

  const metadata = (target as unknown as Record<PropertyKey, unknown>)[
    metadataKey
  ];
  if (metadata === null || typeof metadata !== "object") {
    return undefined;
  }

  return metadata as DecoratorMetadataRecord;
}

export function requireDecoratorMetadataRecord(
  context: MetadataContext,
  decoratorName: string,
  fail: (message: string) => never,
): DecoratorMetadataRecord {
  const metadataKey = getSymbolMetadataKey();
  if (metadataKey === undefined) {
    fail(
      `${decoratorName} requires Symbol.metadata support. Add a Symbol.metadata polyfill before decorators run.`,
    );
  }

  const metadata = context.metadata;
  if (metadata === null || typeof metadata !== "object") {
    fail(
      `${decoratorName} requires standard decorator metadata support. Add a Symbol.metadata polyfill before decorators run.`,
    );
  }

  return metadata as DecoratorMetadataRecord;
}
