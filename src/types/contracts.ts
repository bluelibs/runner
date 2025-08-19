// Solution to enforce input,output contracts from 'tags' and 'middleware'

// A unique symbol key used only for typing (no runtime cost needed)
export declare const CONTRACT: unique symbol;
export type CONTRACT = typeof CONTRACT;

// Generic base for anything that carries input/output contracts
export interface IContractable<TConfig = any, TInput = void, TOutput = void> {
  readonly __containsContract: true;
  // Required brand so TS can always infer the generics
  readonly [CONTRACT]: {
    config: TConfig;
    input: TInput;
    output: TOutput;
  };
}

// Concrete kinds unify on IContractable
export interface ITag<TConfig = any, TOutput = void>
  extends IContractable<TConfig, void, TOutput> {}

export interface IMiddleware<TConfig = any, TInput = void, TOutput = void>
  extends IContractable<TConfig, TInput, TOutput> {}

// Convenience aliases
export type TagType = ITag<any, any>;
export type MiddlewareType = IMiddleware<any, any, any>;
export type ContractableType = IContractable<any, any, any>;

// Helpers
type NonVoid<T> = [T] extends [void] ? never : T;
type IsTuple<T extends readonly unknown[]> = number extends T["length"]
  ? false
  : true;
type UnionToIntersection<U> = (
  U extends any ? (arg: U) => void : never
) extends (arg: infer I) => void
  ? I
  : never;
type Simplify<T> = { [K in keyof T]: T[K] } & {};
type IsUnknown<T> = unknown extends T
  ? [T] extends [unknown]
    ? true
    : false
  : false;
type UnknownToNever<T> = IsUnknown<T> extends true ? never : T;

// Generic extractors from any IContractable via the CONTRACT brand
type ExtractContractOf<
  T,
  Kind extends "input" | "output",
> = T extends IContractable<any, infer I, infer O>
  ? UnknownToNever<Kind extends "input" ? NonVoid<I> : NonVoid<O>>
  : never;

// Filter that preserves tuple shape; array -> Array<Union>
type FilterContractsKind<
  TItems extends readonly unknown[],
  Kind extends "input" | "output",
  Acc extends readonly unknown[] = [],
> = TItems extends readonly [infer H, ...infer R]
  ? ExtractContractOf<H, Kind> extends never
    ? FilterContractsKind<R, Kind, Acc>
    : FilterContractsKind<R, Kind, [...Acc, ExtractContractOf<H, Kind>]>
  : Acc;

type ExtractContractsFromCollection<
  TItems extends readonly unknown[],
  Kind extends "input" | "output",
> = IsTuple<TItems> extends true
  ? FilterContractsKind<TItems, Kind>
  : Array<ExtractContractOf<TItems[number], Kind>>;

// Public API you asked for
export type ExtractInputTypeFromContracts<TItems extends readonly unknown[]> =
  ExtractContractsFromCollection<TItems, "input">;

export type ExtractOutputTypeFromContracts<TItems extends readonly unknown[]> =
  ExtractContractsFromCollection<TItems, "output">;

// Unions and intersections
type ContractsUnionInputs<TItems extends readonly unknown[]> =
  ExtractInputTypeFromContracts<TItems> extends readonly (infer U)[]
    ? U
    : never;

type ContractsUnionOutputs<TItems extends readonly unknown[]> =
  ExtractOutputTypeFromContracts<TItems> extends readonly (infer U)[]
    ? U
    : never;

type ContractsIntersectionInputs<TItems extends readonly unknown[]> =
  UnionToIntersection<ContractsUnionInputs<TItems>>;

type ContractsIntersectionOutputs<TItems extends readonly unknown[]> =
  UnionToIntersection<ContractsUnionOutputs<TItems>>;

// Booleans
export type HasInputContracts<TItems extends readonly unknown[]> = [
  ContractsUnionInputs<TItems>,
] extends [never]
  ? false
  : true;

export type HasOutputContracts<TItems extends readonly unknown[]> = [
  ContractsUnionOutputs<TItems>,
] extends [never]
  ? false
  : true;

// Error shapes
export type InputContractViolationError<
  TItems extends readonly unknown[],
  TActual,
> = {
  message: "Value does not satisfy all input contracts";
  expected: Simplify<ContractsIntersectionInputs<TItems>>;
  received: TActual;
};

export type OutputContractViolationError<
  TItems extends readonly unknown[],
  TActual,
> = {
  message: "Value does not satisfy all output contracts";
  expected: Simplify<ContractsIntersectionOutputs<TItems>>;
  received: TActual;
};

// Enforcement helpers (Promise-aware)
export type EnsureInputSatisfiesContracts<
  TItems extends readonly unknown[],
  TValue,
> = [ContractsUnionInputs<TItems>] extends [never]
  ? TValue
  : TValue extends Promise<infer U>
  ? Promise<
      U extends ContractsIntersectionInputs<TItems>
        ? U
        : InputContractViolationError<TItems, U>
    >
  : TValue extends ContractsIntersectionInputs<TItems>
  ? TValue
  : InputContractViolationError<TItems, TValue>;

export type EnsureOutputSatisfiesContracts<
  TItems extends readonly unknown[],
  TResponse,
> = [ContractsUnionOutputs<TItems>] extends [never]
  ? TResponse
  : TResponse extends Promise<infer U>
  ? Promise<
      U extends ContractsIntersectionOutputs<TItems>
        ? U
        : OutputContractViolationError<TItems, U>
    >
  : TResponse extends ContractsIntersectionOutputs<TItems>
  ? TResponse
  : OutputContractViolationError<TItems, TResponse>;

// Back-compat aliases with your original API
/** @deprecated Use ExtractOutputTypeFromContracts instead */
export type ExtractTagsWithNonVoidReturnTypeFromTags<TTags extends TagType[]> =
  ExtractOutputTypeFromContracts<TTags>;

/** @deprecated Use EnsureOutputSatisfiesContracts instead */
export type EnsureResponseSatisfiesContracts<
  TTags extends TagType[],
  TResponse,
> = EnsureOutputSatisfiesContracts<TTags, TResponse>;
