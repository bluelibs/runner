import {
  ClassPattern,
  WithErrorPolicyPattern,
  LazyPattern,
  MapOfPattern,
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
  ObjectStrictPattern,
  OneOfPattern,
  OptionalPattern,
  RangePattern,
  RegExpPattern,
  WithMessagePattern,
  WherePattern,
} from "./matcher";
import type { MatchClassOptions, MatchSchemaOptions } from "./classSchema";
import type { MatchRuntimeError } from "./errors";

export interface CheckSchemaLike<TParsed = unknown> {
  parse(input: unknown): TParsed;
  toJSONSchema?(options?: MatchToJsonSchemaOptions): MatchJsonSchema;
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
  $ref?: string;
  $defs?: Record<string, MatchJsonSchema>;
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
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  minItems?: number;
  items?: MatchJsonSchema | readonly MatchJsonSchema[];
  properties?: Record<string, MatchJsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | MatchJsonSchema;
  anyOf?: readonly MatchJsonSchema[];
}

export interface MatchToJsonSchemaOptions {
  strict?: boolean;
}

type MatchDecoratorClassConstructor<T = unknown> = abstract new (
  ...args: never[]
) => T;

export type MatchSchemaDecorator = <T extends MatchDecoratorClassConstructor>(
  target: T,
  context: ClassDecoratorContext<T>,
) => void;

export type MatchClassDecorator = MatchSchemaDecorator;

export type MatchPropertyDecorator = (
  value: undefined,
  context: ClassFieldDecoratorContext<object, unknown>,
) => void;

export type { MatchSchemaOptions, MatchClassOptions };

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

type MatchBuiltInToken =
  | typeof matchAnyToken
  | typeof matchEmailToken
  | typeof matchIsoDateStringToken
  | typeof matchIntegerToken
  | typeof matchPositiveIntegerToken
  | typeof matchNonEmptyStringToken
  | typeof matchUrlToken
  | typeof matchUuidToken;

export type MatchPattern =
  | MatchBuiltInToken
  | MatchPrimitiveLiteral
  | MatchConstructorPattern
  | MatchCallablePattern
  | NonEmptyArrayPattern<unknown>
  | OptionalPattern<unknown>
  | MaybePattern<unknown>
  | OneOfPattern<readonly unknown[]>
  | WithMessagePattern<unknown>
  | WithErrorPolicyPattern<unknown>
  | WherePattern<unknown>
  | RangePattern
  | MapOfPattern<unknown>
  | RegExpPattern<RegExp>
  | LazyPattern<unknown>
  | ClassPattern<MatchClassConstructor>
  | ObjectStrictPattern<MatchPatternObject>
  | ObjectIncludingPattern<MatchPatternObject>
  | readonly unknown[]
  | MatchPatternObject;

type MatchNativePattern =
  | MatchBuiltInToken
  | NonEmptyArrayPattern<unknown>
  | OptionalPattern<unknown>
  | MaybePattern<unknown>
  | OneOfPattern<readonly unknown[]>
  | WithMessagePattern<unknown>
  | WithErrorPolicyPattern<unknown>
  | WherePattern<unknown>
  | RangePattern
  | MapOfPattern<unknown>
  | RegExpPattern<RegExp>
  | LazyPattern<unknown>
  | ClassPattern<MatchClassConstructor>
  | ObjectStrictPattern<MatchPatternObject>
  | ObjectIncludingPattern<MatchPatternObject>;

export interface MatchCompiledSchema<
  TPattern extends MatchPattern,
> extends CheckSchemaLike<InferMatchPattern<TPattern>> {
  readonly pattern: TPattern;
  parse(input: unknown): InferMatchPattern<TPattern>;
  test(input: unknown): input is InferMatchPattern<TPattern>;
  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema;
}

type MatchBuiltInInferenceByKind = {
  "Match.Any": any;
  "Match.Email": string;
  "Match.IsoDateString": string;
  "Match.Integer": number;
  "Match.PositiveInteger": number;
  "Match.NonEmptyString": string;
  "Match.URL": string;
  "Match.UUID": string;
};

// Match-native singleton tokens infer from their public `kind`.
type InferMatchBuiltIn<TPattern> = TPattern extends {
  kind: infer TKind;
}
  ? TKind extends keyof MatchBuiltInInferenceByKind
    ? MatchBuiltInInferenceByKind[TKind]
    : never
  : never;

// Match-native wrappers that preserve or reshape another pattern's inference.
type InferMatchWrapperPattern<TPattern> =
  TPattern extends OptionalPattern<infer TInner>
    ? InferMatchPattern<TInner> | undefined
    : TPattern extends MaybePattern<infer TInner>
      ? InferMatchPattern<TInner> | null | undefined
      : TPattern extends OneOfPattern<infer TCandidates>
        ? InferMatchPattern<TCandidates[number]>
        : TPattern extends WithMessagePattern<infer TInner>
          ? InferMatchPattern<TInner>
          : TPattern extends WithErrorPolicyPattern<infer TInner>
            ? InferMatchPattern<TInner>
            : TPattern extends WherePattern<infer TGuarded>
              ? TGuarded
              : TPattern extends RangePattern
                ? number
                : TPattern extends LazyPattern<infer TLazyPattern>
                  ? InferMatchPattern<TLazyPattern>
                  : never;

// Match-native collection and object helpers.
type InferMatchStructuredPattern<TPattern> =
  TPattern extends NonEmptyArrayPattern<infer TArrayPattern>
    ? [
        InferNonEmptyArrayElement<TArrayPattern>,
        ...InferNonEmptyArrayElement<TArrayPattern>[],
      ]
    : TPattern extends MapOfPattern<infer TValuePattern>
      ? Record<string, InferMatchPattern<TValuePattern>>
      : TPattern extends RegExpPattern<RegExp>
        ? string
        : TPattern extends ClassPattern<infer TCtor>
          ? InstanceType<TCtor>
          : TPattern extends ObjectIncludingPattern<infer TObjectPattern>
            ? InferMatchObject<TObjectPattern> & Record<string, unknown>
            : TPattern extends ObjectStrictPattern<infer TObjectPattern>
              ? InferMatchObject<TObjectPattern>
              : never;

// Raw JavaScript pattern language supported by check()/Match.
type InferMatchRawPattern<TPattern> =
  TPattern extends readonly (infer TArrayPattern)[]
    ? InferMatchPattern<TArrayPattern>[]
    : TPattern extends MatchPrimitiveLiteral
      ? TPattern
      : TPattern extends MatchConstructorPattern
        ? InferMatchConstructor<TPattern>
        : TPattern extends MatchCallablePattern
          ? unknown
          : TPattern extends MatchNativePattern
            ? never
            : TPattern extends MatchPatternObject
              ? InferMatchObject<TPattern>
              : never;

type InferMatchResolved<TPattern> =
  | InferMatchBuiltIn<TPattern>
  | InferMatchWrapperPattern<TPattern>
  | InferMatchStructuredPattern<TPattern>
  | InferMatchRawPattern<TPattern>;

export type InferMatchPattern<TPattern> = [
  InferMatchResolved<TPattern>,
] extends [never]
  ? unknown
  : InferMatchResolved<TPattern>;

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

export interface MatchMessageContext<
  TPattern extends MatchPattern = MatchPattern,
> {
  value: unknown;
  parent?: unknown;
  error: MatchRuntimeError;
  path: string;
  pattern: TPattern;
}

export interface MatchMessageDescriptor {
  message: string;
  code?: string;
  params?: Record<string, unknown>;
}

export type MatchMessageOptions<TPattern extends MatchPattern = MatchPattern> =
  | string
  | MatchMessageDescriptor
  | ((
      context: MatchMessageContext<TPattern>,
    ) => string | MatchMessageDescriptor);
