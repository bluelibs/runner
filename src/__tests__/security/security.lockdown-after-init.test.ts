// This suite verifies the system is locked down post-initialization:
// - Adding listeners or interceptors after boot should fail
// - Mutating the store after lock should fail
// These behaviors reduce the attack surface from late-binding instrumentation.
import { defineHook, defineResource } from "../../define";
import { run } from "../../run";
import { globals } from "../../index";

describe("Security: Post-init lockdown", () => {
  it("prevents adding listeners/interceptors and store mutations after lock", async () => {
    let addGlobalListenerFailed = false;
    let addListenerFailed = false;
    let addInterceptorFailed = false;
    let mutateStoreFailed = false;

    const probe = defineHook({
      id: "sec.lock.probe",
      on: globals.events.ready,
      dependencies: {
        eventManager: globals.resources.eventManager,
        store: globals.resources.store,
      },
      run: async (_, { eventManager, store }) => {
        try {
          eventManager.addGlobalListener(async () => {});
        } catch (_) {
          addGlobalListenerFailed = true;
        }

        try {
          // Attempt to add a listener without a real event definition
          // @ts-ignore
          eventManager.addListener({ id: "non.existent" }, async () => {});
        } catch (_) {
          addListenerFailed = true;
        }

        try {
          eventManager.intercept(async (next, ev) => next(ev));
        } catch (_) {
          addInterceptorFailed = true;
        }

        try {
          // Attempt to tamper with store once locked
          // @ts-ignore
          store.storeGenericItem({ id: "attack.resource" });
        } catch (_) {
          mutateStoreFailed = true;
        }
      },
    });

    const app = defineResource({ id: "sec.lock.app", register: [probe] });
    const rr = await run(app);
    await rr.dispose();

    expect(addGlobalListenerFailed).toBe(true);
    expect(addListenerFailed).toBe(true);
    expect(addInterceptorFailed).toBe(true);
    expect(mutateStoreFailed).toBe(true);
  });
});
