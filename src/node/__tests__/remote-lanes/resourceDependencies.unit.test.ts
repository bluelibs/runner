import { collectRemoteLaneResourceDependencies } from "../../remote-lanes/resourceDependencies";

describe("remote lane resource dependency collection", () => {
  it("collects only network-mode resources and deduplicates by dependency key", () => {
    const sharedResource = { id: "queue.shared" };
    const dependencies = collectRemoteLaneResourceDependencies({
      mode: "network",
      bindings: [
        { queue: sharedResource },
        { queue: { id: "queue.other" } },
        { queue: sharedResource },
        { queue: undefined },
      ],
      getResource: (binding) => binding.queue,
      toDependencyKey: (resourceId) => `dep:${resourceId}`,
    });

    expect(dependencies).toEqual({
      "dep:queue.shared": sharedResource,
      "dep:queue.other": { id: "queue.other" },
    });
  });

  it("skips dependency collection outside network mode", () => {
    expect(
      collectRemoteLaneResourceDependencies({
        mode: "transparent",
        bindings: [{ communicator: { id: "comm.a" } }],
        getResource: (binding) => binding.communicator,
        toDependencyKey: (resourceId) => `dep:${resourceId}`,
      }),
    ).toEqual({});
  });
});
