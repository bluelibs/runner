// HasContracts<Meta> → true if contracts present, else false

import { ITag, ITagWithConfig } from "./tags";
import { IMeta } from "./meta";

// Keep these param names aligned with your defs.ts: ITag<TConfig, TEnforceContract>
type NonVoid<T> = [T] extends [void] ? never : T;

type ExtractReturnFromTag<T> = T extends ITagWithConfig<any, infer R>
  ? NonVoid<R>
  : T extends ITag<any, infer R>
  ? NonVoid<R>
  : never;

type IsTuple<T extends readonly unknown[]> = number extends T["length"]
  ? false
  : true;

type FilterContracts<
  TTags extends readonly unknown[],
  Acc extends readonly unknown[] = []
> = TTags extends readonly [infer H, ...infer R]
  ? ExtractReturnFromTag<H> extends never
    ? FilterContracts<R, Acc>
    : FilterContracts<R, [...Acc, ExtractReturnFromTag<H>]>
  : Acc;

export type ExtractContractsFromTags<TTags extends readonly unknown[]> =
  IsTuple<TTags> extends true
    ? FilterContracts<TTags>
    : Array<ExtractReturnFromTag<TTags[number]>>;

export type ExtractTagsWithNonVoidReturnTypeFromMeta<TMeta extends IMeta> =
  TMeta extends { tags?: infer TTags }
    ? TTags extends readonly unknown[]
      ? ExtractContractsFromTags<TTags>
      : []
    : [];

type IsNeverTuple<T extends readonly unknown[]> = T extends [] ? true : false;

export type HasContracts<T extends IMeta> =
  ExtractTagsWithNonVoidReturnTypeFromMeta<T> extends never[] ? false : true; // HasContracts and enforcement

// Ensure a response type satisfies ALL contracts (intersection)
type UnionToIntersection<U> = (
  U extends any ? (arg: U) => void : never
) extends (arg: infer I) => void
  ? I
  : never;

type ContractsUnion<TMeta extends IMeta> =
  ExtractTagsWithNonVoidReturnTypeFromMeta<TMeta> extends readonly (infer U)[]
    ? U
    : never;

type ContractsIntersection<TMeta extends IMeta> = UnionToIntersection<
  ContractsUnion<TMeta>
>;

/**
 * Pretty-print helper to expand intersections for better IDE display.
 */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Verbose compile-time error surfaced when a value does not satisfy
 * the intersection of all tag-enforced contracts.
 *
 * Intersected with `never` in call sites when desired to ensure assignment
 * fails while still surfacing a readable shape in tooltips.
 */
export type ContractViolationError<TMeta extends IMeta, TActual> = {
  message: "Value does not satisfy all tag contracts";
  expected: Simplify<ContractsIntersection<TMeta>>;
  received: TActual;
};

export type EnsureResponseSatisfiesContracts<TMeta extends IMeta, TResponse> = [
  ContractsUnion<TMeta>
] extends [never]
  ? TResponse // no contracts, allow as-is
  : TResponse extends Promise<infer U>
  ? Promise<
      U extends ContractsIntersection<TMeta>
        ? U
        : ContractViolationError<TMeta, U>
    >
  : TResponse extends ContractsIntersection<TMeta>
  ? TResponse
  : ContractViolationError<TMeta, TResponse>;
