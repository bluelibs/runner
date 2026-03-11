// This suite verifies the system is locked down post-initialization:
// - Adding listeners or interceptors after boot should fail
// - Mutating the store after lock should fail
// - Registering task interceptors after lock should fail
// These behaviors reduce the attack surface from late-binding instrumentation.
import { defineHook, defineResource, defineTask } from "../../define";
import { run } from "../../run";
import { events, resources } from "../../index";

describe("Security: Post-init lockdown", () => {
  it("prevents adding listeners/interceptors and store mutations after lock", async () => {
    let addGlobalListenerFailed = false;
    let addListenerFailed = false;
    let addInterceptorFailed = false;
    let mutateStoreFailed = false;

    const probe = defineHook({
      id: "sec-lock-probe",
      on: events.ready,
      dependencies: {
        eventManager: resources.eventManager,
        store: resources.store,
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
          eventManager.addListener({ id: "non-existent" }, async () => {});
        } catch (_) {
          addListenerFailed = true;
        }

        try {
          eventManager.intercept(async (next: any, ev: any) => next(ev));
        } catch (_) {
          addInterceptorFailed = true;
        }

        try {
          // Attempt to tamper with store once locked
          // @ts-ignore
          store.storeGenericItem({ id: "attack-resource" });
        } catch (_) {
          mutateStoreFailed = true;
        }
      },
    });

    const app = defineResource({ id: "sec-lock-app", register: [probe] });
    const rr = await run(app);
    await rr.dispose();

    expect(addGlobalListenerFailed).toBe(true);
    expect(addListenerFailed).toBe(true);
    expect(addInterceptorFailed).toBe(true);
    expect(mutateStoreFailed).toBe(true);
  });

  it("prevents registering local task interceptors after lock", async () => {
    const task = defineTask({
      id: "sec-lock-task",
      run: async (input: number) => input,
    });

    // Capture the task dependency reference (with intercept()) during init,
    // then attempt to use it after run() resolves — at which point store is locked.
    let capturedTaskDep: { intercept: (mw: any) => void } | undefined;

    const app = defineResource({
      id: "sec-lock-taskIntercept-app",
      register: [task],
      dependencies: { task },
      init: async (_, { task: taskDep }) => {
        capturedTaskDep = taskDep;
      },
    });

    const rr = await run(app);

    expect(capturedTaskDep).toBeDefined();
    expect(() =>
      capturedTaskDep!.intercept((next: any, input: any) => next(input)),
    ).toThrow(
      'Cannot register a task interceptor on task "sec-lock-task" from "sec-lock-taskIntercept-app"',
    );

    await rr.dispose();
  });
});
