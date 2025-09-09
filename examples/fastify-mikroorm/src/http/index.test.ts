import { http } from "./index";
import { fastify } from "./resources/fastify.resource";
import { fastifyRouter } from "./resources/fastify-router.resource";
import { httpRoute } from "./tags";
import { onReady } from "./hooks/onReady.hook";
import { healthz } from "./tasks/healthz.task";
import { readyz } from "./tasks/readyz.task";

describe("http module resource", () => {
  it("exposes id and registers expected parts", () => {
    expect(http.id).toBe("app.http.resources.http");
    // Minimal sanity: ensure it wires together our pieces
    const reg = http.register as any[];
    expect(reg).toEqual(
      expect.arrayContaining([fastify, fastifyRouter, httpRoute, onReady, healthz, readyz]),
    );
  });
});

