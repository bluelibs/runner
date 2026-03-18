import { defineResource } from "../../define";
import { globalResources } from "../../globals/globalResources";
import { globalTags } from "../../globals/globalTags";
import { run } from "../../run";
import type { ITimers } from "../../types/timers";

describe("runner.timers", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("is available during init and has no deprecated system tag", async () => {
    jest.useFakeTimers();

    const snapshot: { fired?: boolean } = {};

    const probe = defineResource({
      id: "timers-resource-probe",
      dependencies: { timers: globalResources.timers },
      async init(_config, { timers }) {
        timers.setTimeout(() => {
          snapshot.fired = true;
        }, 0);
        jest.runOnlyPendingTimers();
        return "ok";
      },
    });

    const app = defineResource({
      id: "timers-resource-app",
      register: [probe],
      dependencies: { probe },
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
    });

    expect(snapshot.fired).toBe(true);
    expect(globalResources.timers.tags?.includes(globalTags.system)).not.toBe(
      true,
    );

    await runtime.dispose();
  });

  it("stops accepting new timers once cooldown starts", async () => {
    jest.useFakeTimers();
    const retained: { timers?: ITimers } = {};
    let fired = false;

    const probe = defineResource({
      id: "timers-resource-retained-probe",
      dependencies: { timers: globalResources.timers },
      async init(_config, { timers }) {
        retained.timers = timers;
        timers.setTimeout(() => {
          fired = true;
        }, 50);
        return "ok";
      },
    });

    const app = defineResource({
      id: "timers-resource-retained-app",
      register: [probe],
      dependencies: { probe },
      async init() {
        return "ready";
      },
    });

    const runtime = await run(app, {
      shutdownHooks: false,
    });
    await runtime.dispose();
    jest.runOnlyPendingTimers();

    expect(fired).toBe(false);
    expect(() => retained.timers!.setTimeout(() => undefined, 1)).toThrow(
      "Runner timers are no longer accepting new timers because cooldown or disposal has started.",
    );
  });
});
