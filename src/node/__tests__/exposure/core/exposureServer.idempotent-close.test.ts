import * as http from "http";
import * as lifecycle from "../../../exposure/serverLifecycle";
import { createExposureServer } from "../../../exposure/exposureServer";

describe("createExposureServer - idempotent close", () => {
  const logger = {
    error: () => undefined,
    info: () => undefined,
    print: () => undefined,
  } as any;
  const handler = async () => false;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("awaits in-progress close (owned server via listen)", async () => {
    jest
      .spyOn(lifecycle, "startHttpServer")
      .mockImplementation(async () => undefined);
    const stopSpy = jest
      .spyOn(lifecycle, "stopHttpServer")
      .mockImplementation(async () => {
        await new Promise((r) => setImmediate(r));
      });

    const basePath = "/__runner";
    const controls = await createExposureServer({
      httpConfig: { listen: { port: 0 } },
      handler,
      logger,
      basePath,
    });

    const p1 = controls.close();
    const p2 = controls.close();
    await Promise.all([p1, p2]);

    expect(stopSpy).toHaveBeenCalledTimes(1);
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

  it("exposes createRequestListener() and createServer() factories", async () => {
    const controls = await createExposureServer({
      httpConfig: { server: http.createServer() },
      handler,
      logger,
      basePath: "/x",
    });

    const listener = controls.createRequestListener();
    expect(typeof listener).toBe("function");

    const server = controls.createServer();
    expect(typeof (server as any).on).toBe("function");

    await controls.close();
  });

  it("tolerates undefined detach entries during close cleanup", async () => {
    const external: any = {
      on() {},
      off() {},
    };

    const controls = await createExposureServer({
      httpConfig: { server: external },
      handler,
      logger,
      basePath: "/x",
    });

    const originalPop = Array.prototype.pop;
    let injected = false;
    Array.prototype.pop = function <T>(this: T[]) {
      const value = originalPop.call(this);
      if (!injected && Array.isArray(this) && typeof value === "function") {
        injected = true;
        return undefined as T;
      }
      return value;
    };

    try {
      await expect(controls.close()).resolves.toBeUndefined();
    } finally {
      Array.prototype.pop = originalPop;
    }
  });
});
