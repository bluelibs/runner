import { defineResource } from "../../definers/defineResource";
import {
  runResultDisposedError,
  runtimeHealthDuringBootstrapError,
} from "../../errors";
import { HealthReporter } from "../../models/HealthReporter";
import { storeResource } from "./store.resource";
import type { IHealthReporter } from "../../types/runner";

export const healthResource = defineResource<
  void,
  Promise<IHealthReporter>,
  { store: typeof storeResource }
>({
  id: "health",
  dependencies: { store: storeResource },
  init: async (_config, { store }) => {
    return new HealthReporter(store, {
      ensureAvailable: () => {
        if (!store.isLocked) {
          runtimeHealthDuringBootstrapError.throw();
        }

        if (store.isDisposalStarted()) {
          runResultDisposedError.throw();
        }
      },
      isSleepingResource: (resourceId) =>
        store.resources.get(resourceId)!.isInitialized !== true,
    }) as IHealthReporter;
  },
  meta: {
    title: "Health Reporter",
    description:
      "Read-only resource health aggregation for in-resource diagnostics and operator-facing probes.",
  },
});
