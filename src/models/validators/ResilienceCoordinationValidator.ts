import { rateLimitTaskMiddleware } from "../../globals/middleware/rateLimit.middleware";
import { circuitBreakerMiddleware } from "../../globals/middleware/circuitBreaker.middleware";
import { concurrencyTaskMiddleware } from "../../globals/middleware/concurrency.middleware";
import { resilienceResource } from "../../globals/resilience/resource";
import { resilienceError } from "../../globals/resilience/errors";
import type { CoordinationConfig } from "../../globals/resilience/coordination";
import type { ITaskMiddleware } from "../../types/taskMiddleware";
import type { Semaphore } from "../Semaphore";
import type { ValidatorContext } from "./ValidatorContext";

/** Validate each attachment: middleware definitions share dependencies across configurations. */
export function validateResilienceCoordination(
  ctx: ValidatorContext,
  middleware: ITaskMiddleware,
): void {
  if (
    middleware.run !== rateLimitTaskMiddleware.run &&
    middleware.run !== circuitBreakerMiddleware.run &&
    middleware.run !== concurrencyTaskMiddleware.run
  )
    return;
  const config: CoordinationConfig & { semaphore?: Semaphore } =
    middleware.config;
  if (config.coordination !== "distributed") return;
  if (middleware.run === concurrencyTaskMiddleware.run && config.semaphore) {
    resilienceError.throw({
      message:
        "An explicit semaphore requires local coordination and cannot use distributed coordination.",
    });
  }
  const resilienceId = ctx.resolveReferenceId(resilienceResource);
  if (!resilienceId || !ctx.registry.resources.has(resilienceId)) {
    resilienceError.throw({
      message: `Middleware "${ctx.findIdByDefinition(middleware)}" requires resources.resilience when coordination is "distributed".`,
    });
  }
}
