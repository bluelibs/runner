import { Serializer } from "../../../../serializer";
import { createNodeExposure } from "../../../exposure/createNodeExposure";
import { createMockRuntimeSource } from "../../../../__tests__/test-utils/createMockRuntimeSource";
import {
  createReqRes,
  HttpMethod,
} from "../handlers/requestHandlers.test.utils";

describe("createNodeExposure", () => {
  it("uses empty policy defaults when options are omitted", async () => {
    const serializer = new Serializer();
    const handlers = await createNodeExposure(
      {
        http: {
          basePath: "/__runner",
          auth: { allowAnonymous: true },
        },
      },
      {
        store: {
          tasks: new Map(),
          events: new Map(),
          errors: new Map(),
          asyncContexts: new Map(),
          createRuntimeSource: createMockRuntimeSource,
        } as any,
        authValidators: { tasks: [] } as any,
        taskRunner: { run: async () => undefined } as any,
        eventManager: {
          emit: async () => undefined,
          emitWithResult: async () => undefined,
        } as any,
        logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
        serializer,
      } as any,
    );

    const { req, res } = createReqRes({
      method: HttpMethod.Get,
      url: "/__runner/discovery",
      headers: {},
    });

    await handlers.handleDiscovery(req, res);
    expect(res._status).toBe(200);
    const body = res._buf
      ? (serializer.parse((res._buf as Buffer).toString("utf8")) as any)
      : undefined;
    expect(body?.result?.allowList).toEqual({
      enabled: false,
      tasks: [],
      events: [],
    });

    await handlers.close();
  });
});
