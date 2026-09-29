import { Match } from "../../tools/check";

/** Select local state or require the registered distributed resilience backend. */
export type MiddlewareCoordination = "local" | "distributed";

/** Optional state-placement override for resilience middleware. */
export interface CoordinationConfig {
  /** Omitted adopts registered resilience, otherwise uses memory. Local always uses memory; distributed requires resilience. */
  coordination?: MiddlewareCoordination;
}

export const coordinationPattern = Match.Optional(
  Match.OneOf("local", "distributed"),
);
