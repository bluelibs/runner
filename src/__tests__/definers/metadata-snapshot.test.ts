import { r } from "../..";

type Metadata = {
  title: string;
  nested: { labels: string[] };
  self?: Metadata;
};

const builders = [
  r.task("metadataTask").run(async () => undefined),
  r.resource("metadataResource"),
  r.event("metadataEvent"),
  r
    .hook("metadataHook")
    .on(r.event("watched").build())
    .run(async () => undefined),
  r.middleware.task("metadataTaskMiddleware").run(({ next }) => next()),
  r.middleware.resource("metadataResourceMiddleware").run(({ next }) => next()),
  r.tag("metadataTag"),
  r.error("metadataError"),
  r.asyncContext("metadataContext"),
  r.rpcLane("metadataRpcLane"),
  r.eventLane("metadataEventLane"),
];

describe("builder metadata snapshots", () => {
  it.each(builders)("detaches nested metadata for $id", (builder) => {
    const meta: Metadata = {
      title: "original",
      nested: { labels: ["original"] },
    };
    meta.self = meta;
    const configured = builder.meta(meta);
    meta.nested.labels.push("caller-owned");
    const definition = configured.build();
    const snapshot = definition.meta as Metadata;
    expect(snapshot.nested.labels).toEqual(["original"]);
    expect(snapshot.self).toBe(snapshot);
    expect(Object.isFrozen(snapshot.nested.labels)).toBe(true);
    expect(Object.isFrozen(meta.nested.labels)).toBe(false);
    meta.nested.labels.push("still-writable");
  });
});
