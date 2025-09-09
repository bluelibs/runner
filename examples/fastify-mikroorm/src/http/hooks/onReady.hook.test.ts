import { buildTestRunner } from "#/general/test/utils";

// We'll mock Fastify and its plugins so no real network/listen happens
jest.mock("fastify", () => {
  const listen = jest.fn(async () => void 0);
  const instance = {
    register: jest.fn(async () => void 0),
    setErrorHandler: jest.fn(() => void 0),
    listen,
    close: jest.fn(async () => void 0),
    inject: jest.fn(),
  };
  const factory = () => instance;
  // attach for assertions
  (factory as any).__instance = instance;
  return { __esModule: true, default: factory };
});
jest.mock("@fastify/helmet", () => ({
  __esModule: true,
  default: jest.fn(async () => void 0),
}));
jest.mock("@fastify/cors", () => ({
  __esModule: true,
  default: jest.fn(async () => void 0),
}));
jest.mock("@fastify/swagger", () => ({
  __esModule: true,
  default: jest.fn(async () => void 0),
}));
jest.mock("@fastify/swagger-ui", () => ({
  __esModule: true,
  default: jest.fn(async () => void 0),
}));

import { onReady } from "./onReady.hook";
import { fastify } from "#/http/resources/fastify.resource";

describe("onReady hook", () => {
  it("runs without real network listen", async () => {
    const rr = await buildTestRunner({ register: [fastify, onReady] });
    try {
      const fastifyModule: any = require("fastify");
      const inst = fastifyModule.default.__instance;
      expect(inst.listen).toHaveBeenCalled();
    } finally {
      await rr.dispose();
    }
  });
});
