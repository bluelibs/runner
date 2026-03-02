import type { MatchFailure } from "../errors";
import type { InferMatchPattern } from "../types";

export type PathSegment = string | number;

export type NonEmptyArrayElement<TPattern> = [TPattern] extends [undefined]
  ? unknown
  : InferMatchPattern<TPattern>;

export type MatchContext = {
  failures: MatchFailure[];
  collectAll: boolean;
  activeComparisons: WeakMap<object, WeakSet<object>>;
};

export type WhereCondition<TGuarded = unknown> =
  | ((value: unknown) => boolean)
  | ((value: unknown) => value is TGuarded);
