// Solution to enforce input,output contracts from 'tags' and 'middleware'

import { TagType } from "./tag";
import type { UnionToIntersection } from "./utilities";

// A unique symbol key used both for typing and runtime branding
export const CONTRACT: unique symbol = Symbol.for("runner.contract");
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

// Helpers
export type NonVoid<T> = [T] extends [void] ? never : T;
export type IsTuple<T extends readonly unknown[]> = number extends T["length"]
  ? false
  : true;
export type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type IsUnknown<T> = unknown extends T
  ? [T] extends [unknown]
    ? true
    : false
  : false;
export type UnknownToNever<T> = IsUnknown<T> extends true ? never : T;

// Generic extractors from any IContractable via the CONTRACT brand
export type ExtractContractOf<T, Kind extends "input" | "output"> =
  T extends IContractable<any, infer I, infer O>
    ? UnknownToNever<Kind extends "input" ? NonVoid<I> : NonVoid<O>>
    : never;

// Filter that preserves tuple shape; array -> Array<Union>
export type FilterContractsKind<
  TItems extends readonly unknown[],
  Kind extends "input" | "output",
  Acc extends readonly unknown[] = [],
> = TItems extends readonly [infer H, ...infer R]
  ? ExtractContractOf<H, Kind> extends never
    ? FilterContractsKind<R, Kind, Acc>
    : FilterContractsKind<R, Kind, [...Acc, ExtractContractOf<H, Kind>]>
  : Acc;

export type ExtractContractsFromCollection<
  TItems extends readonly unknown[],
  Kind extends "input" | "output",
> =
  IsTuple<TItems> extends true
    ? FilterContractsKind<TItems, Kind>
    : Array<ExtractContractOf<TItems[number], Kind>>;

// Public API you asked for
export type ExtractInputTypeFromContracts<TItems extends readonly unknown[]> =
  ExtractContractsFromCollection<TItems, "input">;

export type ExtractOutputTypeFromContracts<TItems extends readonly unknown[]> =
  ExtractContractsFromCollection<TItems, "output">;

// Unions and intersections
export type ContractsUnionInputs<TItems extends readonly unknown[]> =
  ExtractInputTypeFromContracts<TItems> extends readonly (infer U)[]
    ? U
    : never;

export type ContractsUnionOutputs<TItems extends readonly unknown[]> =
  ExtractOutputTypeFromContracts<TItems> extends readonly (infer U)[]
    ? U
    : never;

export type ContractsIntersectionInputs<TItems extends readonly unknown[]> =
  UnionToIntersection<ContractsUnionInputs<TItems>>;

export type ContractsIntersectionOutputs<TItems extends readonly unknown[]> =
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

// Collision detection helpers for intersections
export type IsNever<T> = [T] extends [never] ? true : false;
export type KeysWithNever<T> = T extends object
  ? { [K in keyof T]-?: [T[K]] extends [never] ? K : never }[keyof T]
  : never;
export type HasNeverProperty<T> = KeysWithNever<T> extends never ? false : true;
// "Impossible" means either overall never or an object with any `never` property
export type IsImpossibleIntersection<T> =
  IsNever<T> extends true
    ? true
    : HasNeverProperty<T> extends true
      ? true
      : false;

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

// Inferred-input API
// - No input contracts -> void (so the arg can be omitted)
// - Compatible contracts -> intersection
// - Collision -> surfaces InputContractViolationError with helpful expected
export type InferInputOrViolationFromContracts<
  TItems extends readonly unknown[],
> =
  HasInputContracts<TItems> extends false
    ? void
    : ContractsIntersectionInputs<TItems> extends infer I
      ? IsImpossibleIntersection<I> extends true
        ? InputContractViolationError<
            TItems,
            Simplify<I extends never ? never : I>
          >
        : Simplify<I>
      : never;

// Optional-arg tuple helper for nicer ergonomics
export type InputArg<TItems extends readonly unknown[]> = [
  InferInputOrViolationFromContracts<TItems>,
] extends [void]
  ? []
  : [InferInputOrViolationFromContracts<TItems>];

// Optional: guard to surface collisions at the tags argument position
export type InputCollisionGuard<TItems extends readonly unknown[]> =
  IsImpossibleIntersection<ContractsIntersectionInputs<TItems>> extends true
    ? InputContractViolationError<
        TItems,
        Simplify<ContractsIntersectionInputs<TItems>>
      >
    : unknown;

// Mirrored inferred-output helper
export type InferOutputOrViolationFromContracts<
  TItems extends readonly unknown[],
> =
  HasOutputContracts<TItems> extends false
    ? unknown
    : ContractsIntersectionOutputs<TItems> extends infer O
      ? IsImpossibleIntersection<O> extends true
        ? OutputContractViolationError<
            TItems,
            Simplify<O extends never ? never : O>
          >
        : Simplify<O>
      : never;

// Back-compat aliases with your original API
/** @deprecated Use ExtractOutputTypeFromContracts instead */
export type ExtractTagsWithNonVoidReturnTypeFromTags<TTags extends TagType[]> =
  ExtractOutputTypeFromContracts<TTags>;

/** @deprecated Use EnsureOutputSatisfiesContracts instead */
export type EnsureResponseSatisfiesContracts<
  TTags extends TagType[],
  TResponse,
> = EnsureOutputSatisfiesContracts<TTags, TResponse>;
