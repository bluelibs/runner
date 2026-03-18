import { r, run, type IIdentity } from "../../../";
import type { IdentityAsyncContext } from "../../../types/runner";

void (async () => {
  const tenant = r
    .asyncContext<{ tenantId: string; userId: string }>(
      "types-run-tenant-option-ctx",
    )
    .configSchema({
      tenantId: String,
      userId: String,
    })
    .build();

  const app = r
    .resource("types-run-tenant-option-app")
    .register([tenant])
    .build();

  const runtime = await run(app, { identity: tenant });
  const configuredIdentity: IdentityAsyncContext | null =
    runtime.runOptions.identity;
  const identityShape: IIdentity | undefined = configuredIdentity?.tryUse();

  void configuredIdentity;
  void identityShape;
})();
