import { defineEvent, defineEventLane, defineResource } from "../../define";
import { globalTags } from "../../globals/globalTags";
import { eventLanesResource } from "../../node/event-lanes";
import { run } from "../../run";
import { RunnerMode } from "../../types/runner";

describe("Store sanity checks (transactional events)", () => {
  it("fails before initialization when an event is both transactional and parallel", async () => {
    const rootInit = jest.fn(async () => "ok");
    const invalidEvent = defineEvent({
      id: "app-events-tx-parallel-invalid",
      transactional: true,
      parallel: true,
    });

    const app = defineResource({
      id: "app-root-tx-parallel-invalid",
      register: [invalidEvent],
      init: rootInit,
    });

    await expect(run(app, { mode: RunnerMode.TEST })).rejects.toThrow(
      /cannot be both transactional and parallel/i,
    );
    expect(rootInit).not.toHaveBeenCalled();
  });

  it("fails before initialization when a transactional event is assigned through eventLane.applyTo", async () => {
    const rootInit = jest.fn(async () => "ok");
    const invalidEvent = defineEvent({
      id: "app-events-tx-lane-invalid",
      transactional: true,
    });
    const notificationsLane = defineEventLane({
      id: "app-lanes-tx-invalid",
      applyTo: [invalidEvent],
    });

    const app = defineResource({
      id: "app-root-tx-lane-invalid",
      register: [
        invalidEvent,
        eventLanesResource.with({
          profile: "worker",
          mode: "transparent",
          topology: {
            profiles: {
              worker: { consume: [{ lane: notificationsLane }] },
            },
            bindings: [],
          },
        }),
      ],
      init: rootInit,
    });

    await expect(run(app, { mode: RunnerMode.TEST })).rejects.toThrow(
      /cannot be transactional while assigned to eventLane/i,
    );
    expect(rootInit).not.toHaveBeenCalled();
  });

  it("fails before initialization when an event uses deprecated eventLane tags", async () => {
    const rootInit = jest.fn(async () => "ok");
    const notificationsLane = defineEventLane({
      id: "app-lanes-event-invalid",
    });

    const invalidEvent = defineEvent({
      id: "app-events-lanes-invalid",
      tags: [globalTags.eventLane.with({ lane: notificationsLane })],
    });

    const app = defineResource({
      id: "app-root-lanes-invalid",
      register: [invalidEvent],
      init: rootInit,
    });

    await expect(run(app, { mode: RunnerMode.TEST })).rejects.toThrow(
      /uses deprecated tag "eventLane"/i,
    );
    expect(rootInit).not.toHaveBeenCalled();
  });
});
