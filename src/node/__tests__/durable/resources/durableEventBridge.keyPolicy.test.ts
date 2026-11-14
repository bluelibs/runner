import { r, run } from "../../../../index";
import { resources, tags } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import { parseEventPolicy } from "../../../durable/bridge/validation";

describe("durable event key validation", () => {
  it.each(["shared", "app.events.first"])(
    "rejects colliding key %s before effects",
    async (key) => {
      const durable = durableResource.fork("workflows");
      const first = r
        .event("first")
        .tags([
          key === "shared"
            ? tags.durableEvent.with({ key })
            : tags.durableEvent,
        ])
        .build();
      const second = r
        .event("second")
        .tags([tags.durableEvent.with({ key })])
        .build();
      await expect(
        run(
          r
            .resource("app")
            .register([
              resources.durable,
              durable.with({ store: new MemoryStore() }),
              resources.durableEventBridge,
              first,
              second,
            ])
            .build(),
          { logs: { printThreshold: null } },
        ),
      ).rejects.toThrow("already used");
    },
  );

  it("rejects an empty persistence key", () => {
    expect(() => parseEventPolicy({ key: "" })).toThrow();
  });
});
