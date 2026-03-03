import { defineEvent, defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globalTags } from "../../../globals/globalTags";
import { rpcLanesResource } from "../../rpc-lanes";
import { r } from "../../../public";
import * as exposureModule from "../../exposure/createNodeExposure";

describe("rpcLanesResource exposure auth callbacks", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns null for unknown task/event ids and enforces JWT on served events", async () => {
    const servedLane = r
      .rpcLane("tests.rpc-lanes.authz-callbacks.served-lane")
      .build();
    const unservedLane = r
      .rpcLane("tests.rpc-lanes.authz-callbacks.unserved-lane")
      .build();
    const task = defineTask({
      id: "tests.rpc-lanes.authz-callbacks.task",
      tags: [globalTags.rpcLane.with({ lane: servedLane })],
      run: async () => "ok",
    });
    const unservedTask = defineTask({
      id: "tests.rpc-lanes.authz-callbacks.unserved-task",
      tags: [globalTags.rpcLane.with({ lane: unservedLane })],
      run: async () => "ok",
    });
    const event = defineEvent({
      id: "tests.rpc-lanes.authz-callbacks.event",
      tags: [globalTags.rpcLane.with({ lane: servedLane })],
    });
    const communicator = defineResource({
      id: "tests.rpc-lanes.authz-callbacks.communicator",
      init: async () => ({
        task: async () => "remote",
        event: async () => undefined,
      }),
    });
    const topology = r.rpcLane.topology({
      profiles: {
        server: { serve: [servedLane] },
      },
      bindings: [
        {
          lane: servedLane,
          communicator,
          auth: { secret: "callback-secret" },
        },
        {
          lane: unservedLane,
          communicator,
          auth: { secret: "callback-secret" },
        },
      ],
    });

    const callbackAssertions = jest.fn();
    jest
      .spyOn(exposureModule, "createNodeExposure")
      .mockImplementation(async (_cfg, _deps, options) => {
        const authorization = options?.authorization;
        const unknownTask = await authorization?.authorizeTask?.(
          { headers: {} } as any,
          "tests.rpc-lanes.authz-callbacks.unknown-task",
        );
        const unknownEvent = await authorization?.authorizeEvent?.(
          { headers: {} } as any,
          "tests.rpc-lanes.authz-callbacks.unknown-event",
        );
        const unauthorizedServedTask = await authorization?.authorizeTask?.(
          { headers: {} } as any,
          task.id,
        );
        const knownUnservedTask = await authorization?.authorizeTask?.(
          { headers: {} } as any,
          unservedTask.id,
        );
        const unauthorizedServedEvent = await authorization?.authorizeEvent?.(
          { headers: {} } as any,
          event.id,
        );
        callbackAssertions(
          unknownTask,
          unknownEvent,
          unauthorizedServedTask,
          knownUnservedTask,
          unauthorizedServedEvent,
        );

        return {
          handleRequest: async () => false,
          handleTask: async () => undefined,
          handleEvent: async () => undefined,
          handleDiscovery: async () => undefined,
          createRequestListener: () => (_req: any, _res: any) => undefined,
          createServer: () => ({ close: (_cb: any) => undefined }) as any,
          attachTo: () => () => undefined,
          server: undefined,
          basePath: "/__runner",
          close: async () => undefined,
        };
      });

    const app = defineResource({
      id: "tests.rpc-lanes.authz-callbacks.app",
      register: [
        task,
        unservedTask,
        event,
        communicator,
        rpcLanesResource.with({
          profile: "server",
          topology,
          mode: "network",
          exposure: {
            http: {
              basePath: "/__runner",
              auth: { allowAnonymous: true },
            },
          },
        }),
      ],
    });

    const runtime = await run(app);
    await runtime.dispose();

    expect(callbackAssertions).toHaveBeenCalledWith(
      null,
      null,
      expect.objectContaining({ status: 401 }),
      null,
      expect.objectContaining({ status: 401 }),
    );
  });
});
