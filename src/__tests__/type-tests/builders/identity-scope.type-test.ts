import { type IdentityScopeConfig } from "../../../";
import { concurrencyTaskMiddleware } from "../../../globals/middleware/concurrency.middleware";
import { rateLimitTaskMiddleware } from "../../../globals/middleware/rateLimit.middleware";

{
  const requiredScope: IdentityScopeConfig = "required";
  const requiredUserScope: IdentityScopeConfig = "required:userId";
  const fullScope: IdentityScopeConfig = "full";
  const offScope: IdentityScopeConfig = "off";
  const autoScope: IdentityScopeConfig = "auto";
  const autoUserScope: IdentityScopeConfig = "auto:userId";

  rateLimitTaskMiddleware.with({
    windowMs: 1_000,
    max: 1,
    identityScope: requiredScope,
  });

  concurrencyTaskMiddleware.with({
    limit: 1,
    identityScope: offScope,
  });

  rateLimitTaskMiddleware.with({
    windowMs: 1_000,
    max: 1,
    identityScope: requiredUserScope,
  });

  rateLimitTaskMiddleware.with({
    windowMs: 1_000,
    max: 1,
    identityScope: fullScope,
  });

  rateLimitTaskMiddleware.with({
    windowMs: 1_000,
    max: 1,
    identityScope: autoScope,
  });

  rateLimitTaskMiddleware.with({
    windowMs: 1_000,
    max: 1,
    identityScope: autoUserScope,
  });

  // @ts-expect-error unsupported tenant scope mode
  const invalidScope: IdentityScopeConfig = "queue";

  void invalidScope;
}
