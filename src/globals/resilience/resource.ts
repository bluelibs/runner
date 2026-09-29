import { defineResource } from "../../definers/defineResource";
import { Match } from "../../tools/check";
import { resilienceError } from "./errors";
import type { Resilience, ResilienceConfig } from "./types";

/** Internal dependency identity, deliberately absent from automatic built-ins. */
export const resilienceResource = defineResource<
  ResilienceConfig,
  Promise<Resilience>
>({
  id: "resilience",
  configSchema: {
    namespace: Match.NonEmptyString,
    redis: Match.NonEmptyString,
    leaseMs: Match.Optional(Match.PositiveInteger),
  },
  init: async () =>
    resilienceError.throw({
      message: "Redis resilience requires the Node entry point.",
    }),
  dispose: async (backend) => backend.dispose(),
});
