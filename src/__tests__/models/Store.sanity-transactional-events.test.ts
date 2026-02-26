import { defineEvent, defineEventLane, defineResource } from "../../define";
import { globalTags } from "../../globals/globalTags";
import { run } from "../../run";
import { RunnerMode } from "../../types/runner";

describe("Store sanity checks (transactional events)", () => {
  it("fails before initialization when an event is both transactional and parallel", async () => {
    const rootInit = jest.fn(async () => "ok");
    const invalidEvent = defineEvent({
      id: "app.events.tx.parallel.invalid",
      transactional: true,
      parallel: true,
    });

    const app = defineResource({
      id: "app.root.tx.parallel.invalid",
      register: [invalidEvent],
      init: rootInit,
    });

    await expect(run(app, { mode: RunnerMode.TEST })).rejects.toThrow(
      /cannot be both transactional and parallel/i,
    );
    expect(rootInit).not.toHaveBeenCalled();
  });

  it("fails before initialization when a transactional event has an event lane tag", async () => {
    const rootInit = jest.fn(async () => "ok");
    const notificationsLane = defineEventLane({
      id: "app.lanes.tx.invalid",
    });

    const invalidEvent = defineEvent({
      id: "app.events.tx.lane.invalid",
      transactional: true,
      tags: [globalTags.eventLane.with({ lane: notificationsLane })],
    });

    const app = defineResource({
      id: "app.root.tx.lane.invalid",
      register: [invalidEvent],
      init: rootInit,
    });

    await expect(run(app, { mode: RunnerMode.TEST })).rejects.toThrow(
      /cannot be transactional while using lane tag/i,
    );
    expect(rootInit).not.toHaveBeenCalled();
  });
});
