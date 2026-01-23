import * as http from "http";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./security.test.utils";

describe("Fail-Closed Authentication Security", () => {
  it("rejects requests when no auth is configured (fail-closed)", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.auth.failclosed",
      async run() {
        return "should not reach here";
      },
    });
    // No auth configuration at all
    const exposure = nodeExposure.with({
      http: { server: http.createServer(), basePath: "/__runner" },
    });
    const app = defineResource({
      id: "tests.app.security.auth.failclosed",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      await handlers.handleTask(transport.req as any, transport.res as any);

      expect(transport.res.statusCode).toBe(500);
      expect(transport.json.error.code).toBe("AUTH_NOT_CONFIGURED");
      expect(transport.json.error.message).toContain(
        "Authentication not configured",
      );
    } finally {
      await rr.dispose();
    }
  });

  it("allows requests when allowAnonymous is explicitly true", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.auth.allowanon",
      async run() {
        return "allowed";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.security.auth.allowanon",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      await handlers.handleTask(transport.req as any, transport.res as any);

      expect(transport.res.statusCode).toBe(200);
      expect(transport.json.ok).toBe(true);
      expect(transport.json.result).toBe("allowed");
    } finally {
      await rr.dispose();
    }
  });

  it("allows requests when token is configured and provided", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.auth.token",
      async run() {
        return "authenticated";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "secret-token-123" },
      },
    });
    const app = defineResource({
      id: "tests.app.security.auth.token",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: {
          "content-type": "application/json",
          "x-runner-token": "secret-token-123",
        },
        body: "{}",
      });
      await handlers.handleTask(transport.req as any, transport.res as any);

      expect(transport.res.statusCode).toBe(200);
      expect(transport.json.ok).toBe(true);
      expect(transport.json.result).toBe("authenticated");
    } finally {
      await rr.dispose();
    }
  });

  it("rejects requests with wrong token", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.auth.wrongtoken",
      async run() {
        return "should not reach";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "correct-token" },
      },
    });
    const app = defineResource({
      id: "tests.app.security.auth.wrongtoken",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: {
          "content-type": "application/json",
          "x-runner-token": "wrong-token",
        },
        body: "{}",
      });
      await handlers.handleTask(transport.req as any, transport.res as any);

      expect(transport.res.statusCode).toBe(401);
      expect(transport.json.error.code).toBe("UNAUTHORIZED");
    } finally {
      await rr.dispose();
    }
  });
});

describe("Boundary Security Auth Coverage", () => {
  it("handles safeCompare failure (catch block)", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.boundary.safeCompare",
      async run() {
        return "ok";
      },
    });
    const exposure = nodeExposure.with({
      http: { auth: { token: "secret" } },
    });
    const app = defineResource({
      id: "tests.app.security.compare",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: {
          "content-type": "application/json",
          "x-runner-token": { some: "object" } as any,
        },
        body: "{}",
      });
      await handlers.handleTask(transport.req as any, transport.res as any);
      expect(transport.res.statusCode).toBe(401);
    } finally {
      await rr.dispose();
    }
  });
});
