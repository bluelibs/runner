import {
  MaybePattern,
  matchAnyToken,
  matchEmailToken,
  matchIsoDateStringToken,
  matchIntegerToken,
  matchPositiveIntegerToken,
  matchNonEmptyStringToken,
  matchUrlToken,
  matchUuidToken,
  NonEmptyArrayPattern,
  ObjectIncludingPattern,
  OneOfPattern,
  OptionalPattern,
  WherePattern,
} from "./matcher";

export interface CheckSchemaLike<TParsed = unknown> {
  parse(input: unknown): TParsed;
  toJSONSchema?(): MatchJsonSchema;
}

export type MatchJsonPrimitive = string | number | boolean | null;
export type MatchJsonValue =
  | MatchJsonPrimitive
  | MatchJsonObject
  | readonly MatchJsonValue[];

export interface MatchJsonObject {
  [key: string]: MatchJsonValue | undefined;
}

export interface MatchJsonSchema extends MatchJsonObject {
  $schema?: string;
  type?:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "object"
    | "array"
    | "null"
    | readonly (
        | "string"
        | "number"
        | "integer"
        | "boolean"
        | "object"
        | "array"
        | "null"
      )[];
  const?: MatchJsonValue;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  minItems?: number;
  items?: MatchJsonSchema | readonly MatchJsonSchema[];
  properties?: Record<string, MatchJsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | MatchJsonSchema;
  anyOf?: readonly MatchJsonSchema[];
}

type MatchPrimitiveLiteral =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined;

type AnyFunction = (...args: any[]) => any;

type MatchClassConstructor = abstract new (...args: never[]) => unknown;
type MatchCallablePattern = (...args: unknown[]) => unknown;

type MatchConstructorPattern =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | FunctionConstructor
  | ObjectConstructor
  | ArrayConstructor
  | MatchClassConstructor;

type MatchPatternObject = Record<string, unknown>;

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;
type IsUnknown<T> =
  IsAny<T> extends true
    ? false
    : unknown extends T
      ? [T] extends [unknown]
        ? true
        : false
      : false;

type Simplify<T> = { [K in keyof T]: T[K] };
type InferNonEmptyArrayElement<TPattern> = [TPattern] extends [undefined]
  ? unknown
  : InferMatchPattern<TPattern>;

type MatchOptionalWrappers = OptionalPattern<unknown> | MaybePattern<unknown>;
type OptionalPatternKeys<TPattern extends MatchPatternObject> = {
  [K in keyof TPattern]-?: TPattern[K] extends MatchOptionalWrappers
    ? K
    : never;
}[keyof TPattern];
type RequiredPatternKeys<TPattern extends MatchPatternObject> = Exclude<
  keyof TPattern,
  OptionalPatternKeys<TPattern>
>;

type InferMatchObject<TPattern extends MatchPatternObject> = Simplify<
  {
    [K in RequiredPatternKeys<TPattern>]: InferMatchPattern<TPattern[K]>;
  } & {
    [K in OptionalPatternKeys<TPattern>]?: InferMatchPattern<TPattern[K]>;
  }
>;

type InferMatchConstructor<TPattern extends MatchConstructorPattern> =
  TPattern extends StringConstructor
    ? string
    : TPattern extends NumberConstructor
      ? number
      : TPattern extends BooleanConstructor
        ? boolean
        : TPattern extends FunctionConstructor
          ? AnyFunction
          : TPattern extends ObjectConstructor
            ? Record<string, unknown>
            : TPattern extends ArrayConstructor
              ? unknown[]
              : TPattern extends MatchClassConstructor
                ? InstanceType<TPattern>
                : never;

type PatternMismatch<TValue, TExpected> = {
  readonly __runnerCheckPatternMismatch: "Pattern and value types do not overlap.";
  readonly valueType: TValue;
  readonly patternType: TExpected;
};

export type MatchPattern =
  | typeof matchAnyToken
  | typeof matchEmailToken
  | typeof matchIsoDateStringToken
  | typeof matchIntegerToken
  | typeof matchPositiveIntegerToken
  | typeof matchNonEmptyStringToken
  | typeof matchUrlToken
  | typeof matchUuidToken
  | MatchPrimitiveLiteral
  | MatchConstructorPattern
  | MatchCallablePattern
  | NonEmptyArrayPattern<unknown>
  | OptionalPattern<unknown>
  | MaybePattern<unknown>
  | OneOfPattern<readonly unknown[]>
  | WherePattern<unknown>
  | ObjectIncludingPattern<MatchPatternObject>
  | readonly unknown[]
  | MatchPatternObject;

export interface MatchCompiledSchema<
  TPattern extends MatchPattern,
> extends CheckSchemaLike<InferMatchPattern<TPattern>> {
  readonly pattern: TPattern;
  parse(input: unknown): InferMatchPattern<TPattern>;
  toJSONSchema(): MatchJsonSchema;
}

export type InferMatchPattern<TPattern> = TPattern extends typeof matchAnyToken
  ? any
  : TPattern extends typeof matchEmailToken
    ? string
    : TPattern extends typeof matchIsoDateStringToken
      ? string
      : TPattern extends typeof matchIntegerToken
        ? number
        : TPattern extends typeof matchPositiveIntegerToken
          ? number
          : TPattern extends typeof matchNonEmptyStringToken
            ? string
            : TPattern extends typeof matchUrlToken
              ? string
              : TPattern extends typeof matchUuidToken
                ? string
                : TPattern extends NonEmptyArrayPattern<infer TArrayPattern>
                  ? [
                      InferNonEmptyArrayElement<TArrayPattern>,
                      ...InferNonEmptyArrayElement<TArrayPattern>[],
                    ]
                  : TPattern extends OptionalPattern<infer TInner>
                    ? InferMatchPattern<TInner> | undefined
                    : TPattern extends MaybePattern<infer TInner>
                      ? InferMatchPattern<TInner> | null | undefined
                      : TPattern extends OneOfPattern<infer TCandidates>
                        ? InferMatchPattern<TCandidates[number]>
                        : TPattern extends WherePattern<infer TGuarded>
                          ? TGuarded
                          : TPattern extends ObjectIncludingPattern<
                                infer TObjectPattern
                              >
                            ? InferMatchObject<TObjectPattern> &
                                Record<string, unknown>
                            : TPattern extends readonly (infer TArrayPattern)[]
                              ? InferMatchPattern<TArrayPattern>[]
                              : TPattern extends MatchPrimitiveLiteral
                                ? TPattern
                                : TPattern extends MatchConstructorPattern
                                  ? InferMatchConstructor<TPattern>
                                  : TPattern extends MatchCallablePattern
                                    ? unknown
                                    : TPattern extends MatchPatternObject
                                      ? InferMatchObject<TPattern>
                                      : unknown;

export type EnsurePatternOverlap<TValue, TExpected> =
  IsAny<TValue> extends true
    ? unknown
    : IsUnknown<TValue> extends true
      ? unknown
      : IsNever<TValue> extends true
        ? unknown
        : [Extract<TValue, TExpected>] extends [never]
          ? [Extract<TExpected, TValue>] extends [never]
            ? PatternMismatch<TValue, TExpected>
            : unknown
          : unknown;

export type CheckedValue<TValue, TPattern extends MatchPattern> =
  IsAny<TValue> extends true
    ? InferMatchPattern<TPattern>
    : TValue & InferMatchPattern<TPattern>;

export type InferCheckSchema<TSchema> =
  TSchema extends CheckSchemaLike<infer TParsed> ? TParsed : never;
