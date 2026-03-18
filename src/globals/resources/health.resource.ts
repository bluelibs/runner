import { defineResource } from "../../definers/defineResource";
import {
  runResultDisposedError,
  runtimeHealthDuringBootstrapError,
} from "../../errors";
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
    return {
      getHealth: (resourceDefs) =>
        store.getHealthReporter().getHealth(resourceDefs, {
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
        }),
    } satisfies IHealthReporter;
  },
  meta: {
    title: "Health Reporter",
    description:
      "Read-only resource health aggregation for in-resource diagnostics and operator-facing probes.",
  },
});
