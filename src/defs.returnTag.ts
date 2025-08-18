// HasContracts<Meta> → true if contracts present, else false

import { ITag, TagType } from "./defs";
import { IMeta } from "./defs";

// Keep these param names aligned with your defs.ts: ITag<TConfig, TEnforceContract>
type NonVoid<T> = [T] extends [void] ? never : T;

type ExtractReturnFromTag<T> = T extends ITag<any, infer R>
  ? NonVoid<R>
  : never;

type IsTuple<T extends readonly unknown[]> = number extends T["length"]
  ? false
  : true;

type FilterContracts<
  TTags extends readonly unknown[],
  Acc extends readonly unknown[] = [],
> = TTags extends readonly [infer H, ...infer R]
  ? ExtractReturnFromTag<H> extends never
    ? FilterContracts<R, Acc>
    : FilterContracts<R, [...Acc, ExtractReturnFromTag<H>]>
  : Acc;

export type ExtractContractsFromTags<TTags extends readonly unknown[]> =
  IsTuple<TTags> extends true
    ? FilterContracts<TTags>
    : Array<ExtractReturnFromTag<TTags[number]>>;

export type ExtractTagsWithNonVoidReturnTypeFromTags<TTags extends TagType[]> =
  TTags extends readonly unknown[] ? ExtractContractsFromTags<TTags> : [];

/** @deprecated Use ExtractTagsWithNonVoidReturnTypeFromTags instead */
export type ExtractTagsWithNonVoidReturnTypeFromMeta<TMeta extends IMeta> =
  TMeta extends { tags?: infer TTags }
    ? TTags extends readonly unknown[]
      ? ExtractContractsFromTags<TTags>
      : []
    : [];

export type HasContracts<T extends TagType[]> =
  ContractsUnionTags<T> extends never[] ? false : true; // HasContracts and enforcement

// Ensure a response type satisfies ALL contracts (intersection)
type UnionToIntersection<U> = (
  U extends any ? (arg: U) => void : never
) extends (arg: infer I) => void
  ? I
  : never;

type ContractsUnionTags<T extends TagType[]> =
  ExtractTagsWithNonVoidReturnTypeFromTags<T> extends readonly (infer U)[]
    ? U
    : never;

/** @deprecated */
type ContractsUnion<TMeta extends IMeta> =
  ExtractTagsWithNonVoidReturnTypeFromMeta<TMeta> extends readonly (infer U)[]
    ? U
    : never;

type ContractsIntersection<TTags extends TagType[]> = UnionToIntersection<
  ContractsUnionTags<TTags>
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
export type ContractViolationError<TTags extends TagType[], TActual> = {
  message: "Value does not satisfy all tag contracts";
  expected: Simplify<ContractsIntersection<TTags>>;
  received: TActual;
};

export type EnsureResponseSatisfiesContracts<
  TTags extends TagType[],
  TResponse,
> = [ContractsUnionTags<TTags>] extends [never]
  ? TResponse // no contracts, allow as-is
  : TResponse extends Promise<infer U>
  ? Promise<
      U extends ContractsIntersection<TTags>
        ? U
        : ContractViolationError<TTags, U>
    >
  : TResponse extends ContractsIntersection<TTags>
  ? TResponse
  : ContractViolationError<TTags, TResponse>;
