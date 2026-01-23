import * as http from "http";
import { createExposureServer } from "../../exposure/exposureServer";

// Mock serverLifecycle to avoid real listen/close and to control timing
jest.mock("../../exposure/serverLifecycle", () => {
  const actual = jest.requireActual("../../exposure/serverLifecycle");
  return {
    ...actual,
    startHttpServer: jest.fn(async () => {
      // no-op
    }),
    stopHttpServer: jest.fn(async () => {
      // ensure close takes at least one tick so concurrent close can await it
      await new Promise((r) => setImmediate(r));
    }),
  };
});

describe("createExposureServer - idempotent close", () => {
  const logger = {
    error: () => undefined,
    info: () => undefined,
    print: () => undefined,
  } as any;
  const handler = async () => false;

  it("awaits in-progress close (owned server via listen)", async () => {
    const basePath = "/__runner";
    const controls = await createExposureServer({
      httpConfig: { listen: { port: 0 } },
      handler,
      logger,
      basePath,
    });

    const { stopHttpServer } = require("../../exposure/serverLifecycle");

    const p1 = controls.close();
    const p2 = controls.close();
    await Promise.all([p1, p2]);

    expect(stopHttpServer).toHaveBeenCalledTimes(1);
  });

  it("detaches only once (external server)", async () => {
    let onCount = 0;
    let offCount = 0;
    const external: any = {
      on(event: string, _listener: http.RequestListener) {
        if (event === "request") onCount++;
      },
      off(event: string, _listener: http.RequestListener) {
        if (event === "request") offCount++;
      },
    };

    const controls = await createExposureServer({
      httpConfig: { server: external },
      handler,
      logger,
      basePath: "/x",
    });

    const p1 = controls.close();
    const p2 = controls.close();
    await Promise.all([p1, p2]);

    expect(onCount).toBe(1);
    expect(offCount).toBe(1);
  });
});
