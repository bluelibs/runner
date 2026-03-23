import {
  collectEventTopologyLanes,
  collectRpcTopologyLanes,
} from "../../remote-lanes/topologyLanes";

function expectRunnerErrorId(fn: () => unknown, errorId: string): void {
  try {
    fn();
    throw new Error(`Expected RunnerError "${errorId}"`);
  } catch (error) {
    const candidate = error as { id?: string; name?: string };
    expect(candidate.id ?? candidate.name).toBe(errorId);
  }
}

describe("remote-lanes topology lane collection", () => {
  it("reuses the same event lane instance across bindings and profiles", () => {
    const lane = { id: "tests-event-topology-lane" } as any;

    expect(
      collectEventTopologyLanes({
        profiles: {
          worker: { consume: [{ lane }] },
        },
        bindings: [{ lane, queue: {} as any }],
      } as any),
    ).toEqual([lane]);
  });

  it("fails fast when event lanes reuse an id with distinct instances", () => {
    const bindingLane = { id: "tests-topology-shared-event-lane" } as any;
    const profileLane = { id: "tests-topology-shared-event-lane" } as any;

    expectRunnerErrorId(
      () =>
        collectEventTopologyLanes({
          profiles: {
            worker: { consume: [{ lane: profileLane }] },
          },
          bindings: [{ lane: bindingLane, queue: {} as any }],
        } as any),
      "remoteLanes-topologyConflict",
    );
  });

  it("fails fast when rpc lanes reuse an id with distinct instances", () => {
    const bindingLane = { id: "tests-topology-shared-rpc-lane" } as any;
    const profileLane = { id: "tests-topology-shared-rpc-lane" } as any;

    expectRunnerErrorId(
      () =>
        collectRpcTopologyLanes({
          profiles: {
            client: { serve: [profileLane] },
          },
          bindings: [{ lane: bindingLane, communicator: {} as any }],
        } as any),
      "remoteLanes-topologyConflict",
    );
  });
});
