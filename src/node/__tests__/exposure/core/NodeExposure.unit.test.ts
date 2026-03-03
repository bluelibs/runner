import { NodeExposure } from "../../../exposure/NodeExposure";
import * as createNodeExposureModule from "../../../exposure/createNodeExposure";
import { EMPTY_NODE_EXPOSURE_POLICY } from "../../../exposure/policy";

describe("NodeExposure", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts once, caches handlers, and closes idempotently", async () => {
    const close = jest.fn(async () => undefined);
    const handlers = { close } as any;
    const createSpy = jest
      .spyOn(createNodeExposureModule, "createNodeExposure")
      .mockResolvedValue(handlers);

    const deps: any = {
      store: {},
      authValidators: { tasks: [] },
      taskRunner: {},
      eventManager: {},
      logger: {},
      serializer: {},
    };

    const exposure = new NodeExposure({
      deps,
      policy: EMPTY_NODE_EXPOSURE_POLICY,
    });

    expect(exposure.getHandlers()).toBeNull();
    await exposure.close();

    const first = await exposure.start();
    const second = await exposure.start();
    expect(first).toBe(handlers);
    expect(second).toBe(handlers);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(
      { http: undefined },
      deps,
      expect.objectContaining({
        sourceResourceId: "platform.node.resources.rpcLanes",
      }),
    );

    await exposure.close();
    await exposure.close();
    expect(close).toHaveBeenCalledTimes(1);
    expect(exposure.getHandlers()).toBeNull();
  });

  it("passes custom owner resource id to runtime source attribution", async () => {
    const handlers = { close: async () => undefined } as any;
    const createSpy = jest
      .spyOn(createNodeExposureModule, "createNodeExposure")
      .mockResolvedValue(handlers);

    const exposure = new NodeExposure({
      deps: {
        store: {} as any,
        authValidators: { tasks: [] } as any,
        taskRunner: {} as any,
        eventManager: {} as any,
        logger: {} as any,
        serializer: {} as any,
      },
      policy: EMPTY_NODE_EXPOSURE_POLICY,
      ownerResourceId: "tests.owner.resource",
    });

    await exposure.start();
    expect(createSpy).toHaveBeenCalledWith(
      { http: undefined },
      expect.anything(),
      expect.objectContaining({
        sourceResourceId: "tests.owner.resource",
      }),
    );
  });
});
