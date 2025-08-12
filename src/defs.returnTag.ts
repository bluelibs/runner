// HasContracts<Meta> → true if contracts present, else false

import { ITag, ITagWithConfig } from "./defs";
import { IMeta } from "./defs";

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

export type HasContracts<TMeta extends IMeta> =
  ExtractTagsWithNonVoidReturnTypeFromMeta<TMeta> extends readonly (infer _U)[]
    ? IsNeverTuple<ExtractTagsWithNonVoidReturnTypeFromMeta<TMeta>> extends true
      ? false
      : true
    : false;

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

export type EnsureResponseSatisfiesContracts<TMeta extends IMeta, TResponse> = [
  ContractsUnion<TMeta>
] extends [never]
  ? TResponse // no contracts, allow as-is
  : TResponse extends ContractsIntersection<TMeta>
  ? TResponse
  : never;
