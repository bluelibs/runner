import { type TenantScopeConfig } from "../../../";
import { concurrencyTaskMiddleware } from "../../../globals/middleware/concurrency.middleware";
import { rateLimitTaskMiddleware } from "../../../globals/middleware/rateLimit.middleware";

{
  const requiredScope: TenantScopeConfig = "required";
  const offScope: TenantScopeConfig = "off";
  const autoScope: TenantScopeConfig = "auto";

  rateLimitTaskMiddleware.with({
    windowMs: 1_000,
    max: 1,
    tenantScope: requiredScope,
  });

  concurrencyTaskMiddleware.with({
    limit: 1,
    tenantScope: offScope,
  });

  rateLimitTaskMiddleware.with({
    windowMs: 1_000,
    max: 1,
    tenantScope: autoScope,
  });

  // @ts-expect-error unsupported tenant scope mode
  const invalidScope: TenantScopeConfig = "queue";

  void invalidScope;
}
