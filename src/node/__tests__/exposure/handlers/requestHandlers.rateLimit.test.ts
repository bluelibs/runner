import * as http from "http";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./security.test.utils";

describe("requestHandlers - Auth rate limiting", () => {
  it("returns 429 after exceeding auth failure threshold", async () => {
    const t = defineTask<void, Promise<string>>({
      id: "tests.ratelimit.task",
      async run() {
        return "ok";
      },
    });

    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: {
          token: "VALID_TOKEN",
          rateLimit: { maxFailures: 3, windowMs: 60_000 },
        },
      },
    });

    const app = defineResource({
      id: "tests.app.ratelimit",
      register: [t, exposure],
    });

    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);

      // Send 3 failed auth requests to reach the threshold
      for (let i = 0; i < 3; i++) {
        const transport = createReqRes({
          method: "POST",
          url: `/__runner/task/${t.id}`,
          headers: { "x-runner-token": "WRONG" },
          body: "{}",
        });
        await handlers.handleRequest(transport.req, transport.res);
        expect(transport.res.statusCode).toBe(401);
      }

      // The 4th request should be rate-limited (429)
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/task/${t.id}`,
        headers: { "x-runner-token": "WRONG" },
        body: "{}",
      });
      await handlers.handleRequest(transport.req, transport.res);
      expect(transport.res.statusCode).toBe(429);
      expect(transport.text).toContain("RATE_LIMITED");
    } finally {
      await rr.dispose();
    }
  });

  it("disables rate limiting when rateLimit is false", async () => {
    const t = defineTask<void, Promise<string>>({
      id: "tests.ratelimit.disabled.task",
      async run() {
        return "ok";
      },
    });

    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: {
          token: "VALID_TOKEN",
          rateLimit: false,
        },
      },
    });

    const app = defineResource({
      id: "tests.app.ratelimit.disabled",
      register: [t, exposure],
    });

    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);

      // Send many failed auth requests — should never get 429
      for (let i = 0; i < 15; i++) {
        const transport = createReqRes({
          method: "POST",
          url: `/__runner/task/${t.id}`,
          headers: { "x-runner-token": "WRONG" },
          body: "{}",
        });
        await handlers.handleRequest(transport.req, transport.res);
        expect(transport.res.statusCode).toBe(401);
      }
    } finally {
      await rr.dispose();
    }
  });
});
