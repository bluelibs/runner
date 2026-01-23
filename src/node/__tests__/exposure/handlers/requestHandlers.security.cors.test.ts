import * as http from "http";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./security.test.utils";

describe("CORS Security", () => {
  it("denies credentials without explicit origin configuration", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.cors.credentialsnoorgin",
      async run() {
        return "ok";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
        // credentials=true but no origin specified - should NOT echo origin
        cors: { credentials: true },
      },
    });
    const app = defineResource({
      id: "tests.app.security.cors.credentialsnoorgin",
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
          origin: "https://evil-site.com",
        },
        body: "{}",
      });
      await handlers.handleTask(transport.req as any, transport.res as any);

      // Should NOT echo the origin back - that would be insecure
      expect(transport.headers["access-control-allow-origin"]).not.toBe(
        "https://evil-site.com",
      );
    } finally {
      await rr.dispose();
    }
  });

  it("allows credentials with explicit origin configuration", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.cors.credentialswithorigin",
      async run() {
        return "ok";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
        cors: {
          credentials: true,
          origin: ["https://trusted-site.com"],
        },
      },
    });
    const app = defineResource({
      id: "tests.app.security.cors.credentialswithorigin",
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
          origin: "https://trusted-site.com",
        },
        body: "{}",
      });
      await handlers.handleTask(transport.req as any, transport.res as any);

      expect(transport.headers["access-control-allow-origin"]).toBe(
        "https://trusted-site.com",
      );
      expect(transport.headers["access-control-allow-credentials"]).toBe(
        "true",
      );
    } finally {
      await rr.dispose();
    }
  });

  it("rejects untrusted origins when allowlist is configured", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.cors.untrusted",
      async run() {
        return "ok";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
        cors: {
          credentials: true,
          origin: ["https://trusted-site.com"],
        },
      },
    });
    const app = defineResource({
      id: "tests.app.security.cors.untrusted",
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
          origin: "https://evil-site.com",
        },
        body: "{}",
      });
      await handlers.handleTask(transport.req as any, transport.res as any);

      // Should not set Access-Control-Allow-Origin for untrusted origins
      expect(transport.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await rr.dispose();
    }
  });
});
