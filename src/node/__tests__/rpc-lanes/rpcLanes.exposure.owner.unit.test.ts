import { startRpcLanesExposure } from "../../rpc-lanes/rpcLanes.exposure";

describe("rpcLanes exposure owner guard", () => {
  it("fails fast when exposure owner resource id is not rpcLanes", async () => {
    await expect(
      startRpcLanesExposure({
        config: {
          profile: "server",
          topology: {
            profiles: { server: { serve: [] } },
            bindings: [],
          } as any,
          exposure: {
            http: {},
          },
        } as any,
        resolved: {
          profile: "server",
          mode: "network",
          serveLaneIds: new Set<string>(),
          bindingsByLaneId: new Map(),
          taskLaneByTaskId: new Map(),
          eventLaneByEventId: new Map(),
          serveTaskIds: new Set<string>(["task.id"]),
          serveEventIds: new Set<string>(),
          taskAllowAsyncContext: new Map(),
          eventAllowAsyncContext: new Map(),
          taskAsyncContextAllowList: new Map(),
          eventAsyncContextAllowList: new Map(),
          communicatorByLaneId: new Map(),
        },
        dependencies: {
          logger: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          },
        } as any,
        resourceId: "tests.invalid.owner",
      }),
    ).rejects.toMatchObject({
      name: "runner.errors.rpcLane.exposureOwnerInvalid",
    });
  });
});
