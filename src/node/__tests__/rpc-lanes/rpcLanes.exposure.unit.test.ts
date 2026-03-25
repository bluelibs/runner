import * as exposureModule from "../../exposure/createNodeExposure";
import { startRpcLanesExposure } from "../../rpc-lanes/rpcLanes.exposure";

describe("rpcLanes.exposure", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns null auth-body decisions when the target is not served by the active lane set", async () => {
    let capturedOptions: any;
    jest
      .spyOn(exposureModule, "createNodeExposure")
      .mockImplementation(async (_cfg, _deps, options) => {
        capturedOptions = options;
        return {
          close: async () => undefined,
        } as any;
      });

    await startRpcLanesExposure({
      resourceId: "rpcLanes",
      config: {
        profile: "server",
        mode: "network",
        exposure: {
          http: {
            listen: { port: 0, host: "127.0.0.1" },
            auth: { allowAnonymous: true },
          },
        },
      },
      resolved: {
        mode: "network",
        profile: "server",
        serveLaneIds: new Set(["lane-served"]),
        taskLaneByTaskId: new Map([["task-off-lane", { id: "lane-off" }]]),
        eventLaneByEventId: new Map([["event-off-lane", { id: "lane-off" }]]),
        bindingsByLaneId: new Map(),
        serveTaskIds: new Set(["task-off-lane"]),
        serveEventIds: new Set(["event-off-lane"]),
        taskAllowAsyncContext: new Map(),
        eventAllowAsyncContext: new Map(),
        taskAsyncContextAllowList: new Map(),
        eventAsyncContextAllowList: new Map(),
        communicatorByLaneId: new Map(),
      },
      dependencies: {
        store: {
          findIdByDefinition: (id: string) => id,
        },
        logger: { warn: jest.fn() },
      },
    } as any);

    expect(
      await capturedOptions.authorization.authorizeTaskBody(
        { headers: {} },
        "task-off-lane",
        "{}",
      ),
    ).toBeNull();
    expect(
      await capturedOptions.authorization.authorizeEventBody(
        { headers: {} },
        "event-off-lane",
        "{}",
      ),
    ).toBeNull();
  });
});
