type MatchDecoratorClassConstructor<T = unknown> = abstract new (
  ...args: never[]
) => T;

export type LegacyMatchSchemaDecorator = <
  T extends MatchDecoratorClassConstructor,
>(
  target: T,
) => void;

export type LegacyMatchClassDecorator = LegacyMatchSchemaDecorator;

export type LegacyMatchPropertyDecorator = (
  target: object | Function,
  propertyKey: string | symbol,
) => void;
