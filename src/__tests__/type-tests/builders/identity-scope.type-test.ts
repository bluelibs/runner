import { type IdentityScopeConfig } from "../../../";
import { concurrencyTaskMiddleware } from "../../../globals/middleware/concurrency.middleware";
import { rateLimitTaskMiddleware } from "../../../globals/middleware/rateLimit.middleware";

{
  const globalScope: IdentityScopeConfig = { tenant: false };
  const requiredTenantScope: IdentityScopeConfig = { tenant: true };
  const optionalTenantScope: IdentityScopeConfig = {
    required: false,
    tenant: true,
  };
  const requiredUserScope: IdentityScopeConfig = {
    tenant: true,
    user: true,
  };
  const optionalUserScope: IdentityScopeConfig = {
    required: false,
    tenant: true,
    user: true,
  };

  rateLimitTaskMiddleware.with({
    windowMs: 1_000,
    max: 1,
    identityScope: requiredTenantScope,
  });

  concurrencyTaskMiddleware.with({
    limit: 1,
    identityScope: globalScope,
  });

  concurrencyTaskMiddleware.with({
    limit: 1,
    identityScope: optionalTenantScope,
  });

  rateLimitTaskMiddleware.with({
    windowMs: 1_000,
    max: 1,
    identityScope: requiredUserScope,
  });

  rateLimitTaskMiddleware.with({
    windowMs: 1_000,
    max: 1,
    identityScope: optionalUserScope,
  });

  // @ts-expect-error identityScope requires tenant config when enabling user partitioning
  const invalidScope: IdentityScopeConfig = { user: true };
  // @ts-expect-error identityScope cannot enable user partitioning when tenant partitioning is off
  const invalidGlobalUserScope: IdentityScopeConfig = {
    tenant: false,
    user: true,
  };

  void invalidScope;
  void invalidGlobalUserScope;
}
