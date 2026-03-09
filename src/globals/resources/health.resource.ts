import { frameworkResource } from "../../definers/builders/resource";
import {
  runResultDisposedError,
  runtimeHealthDuringBootstrapError,
} from "../../errors";
import { HealthReporter } from "../../models/HealthReporter";
import { storeResource } from "./store.resource";
import type { IHealthReporter } from "../../types/runner";

export const healthResource = frameworkResource<void>("runner.health")
  .dependencies({ store: storeResource })
  .init(async (_config, { store }) => {
    return new HealthReporter(store, {
      ensureAvailable: () => {
        if (!store.isLocked) {
          runtimeHealthDuringBootstrapError.throw();
        }

        if (store.isInShutdownLockdown()) {
          runResultDisposedError.throw();
        }
      },
      isSleepingResource: (resourceId) =>
        store.resources.get(resourceId)!.isInitialized !== true,
    }) as IHealthReporter;
  })
  .meta({
    title: "Health Reporter",
    description:
      "Read-only resource health aggregation for in-resource diagnostics and operator-facing probes.",
  })
  .build();
