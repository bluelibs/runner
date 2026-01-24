import * as http from "http";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { error } from "../../../../definers/builders/error";
import { useExposureContext } from "../../../exposure/requestContext";
import { cancellationError } from "../../../../errors";
import { createReqRes } from "./security.test.utils";

describe("requestHandlers - Security", () => {
  describe("Authentication", () => {
    it("rejects requests when no auth is configured (fail-closed)", async () => {
      const t = defineTask<any, Promise<string>>({
        id: "tests.security.auth.failclosed",
        async run() {
          return "should not reach here";
        },
      });
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

    it("handles safeCompare failure (catch block)", async () => {
      const t = defineTask<any, Promise<string>>({
        id: "tests.security.auth.safeCompare",
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

  describe("CORS", () => {
    it("denies credentials without explicit origin configuration", async () => {
      const t = defineTask<any, Promise<string>>({
        id: "tests.security.cors.denied",
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
          cors: { credentials: true },
        },
      });
      const app = defineResource({
        id: "tests.app.security.cors.denied",
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
            origin: "https://evil.com",
          },
          body: "{}",
        });
        await handlers.handleTask(transport.req as any, transport.res as any);
        expect(transport.headers["access-control-allow-origin"]).not.toBe(
          "https://evil.com",
        );
      } finally {
        await rr.dispose();
      }
    });

    it("allows credentials with explicit origin configuration", async () => {
      const t = defineTask<any, Promise<string>>({
        id: "tests.security.cors.allowed",
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
          cors: { credentials: true, origin: ["https://trusted.com"] },
        },
      });
      const app = defineResource({
        id: "tests.app.security.cors.allowed",
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
            origin: "https://trusted.com",
          },
          body: "{}",
        });
        await handlers.handleTask(transport.req as any, transport.res as any);
        expect(transport.headers["access-control-allow-origin"]).toBe(
          "https://trusted.com",
        );
        expect(transport.headers["access-control-allow-credentials"]).toBe(
          "true",
        );
      } finally {
        await rr.dispose();
      }
    });
  });

  describe("Limits", () => {
    it("rejects JSON body > 2MB with 413", async () => {
      const t = defineTask<any, Promise<string>>({
        id: "tests.security.limits.json",
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
        },
      });
      const app = defineResource({
        id: "tests.app.security.limits.json",
        register: [t, exposure],
      });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const largeBody = JSON.stringify({
          data: "a".repeat(2 * 1024 * 1024 + 1),
        });
        const transport = createReqRes({
          method: "POST",
          url: `/__runner/task/${encodeURIComponent(t.id)}`,
          headers: { "content-type": "application/json" },
          body: largeBody,
        });
        await handlers.handleTask(transport.req as any, transport.res as any);
        expect(transport.res.statusCode).toBe(413);
        expect(transport.json.error.code).toBe("PAYLOAD_TOO_LARGE");
      } finally {
        await rr.dispose();
      }
    });

    it("handles requestBody multi-chunk abortion and custom maxSize", async () => {
      const t = defineTask<{ x: string }, Promise<string>>({
        id: "tests.security.limits.json.multi",
        async run({ x }) {
          return x;
        },
      });
      const exposure = nodeExposure.with({
        http: {
          dangerouslyAllowOpenExposure: true,
          limits: { json: { maxSize: 100 } },
          auth: { allowAnonymous: true },
        },
      });
      const app = defineResource({
        id: "tests.app.security.limits.json.multi",
        register: [t, exposure],
      });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const { req, res } = createReqRes({
          method: "POST",
          url: `/__runner/task/${encodeURIComponent(t.id)}`,
          headers: { "content-type": "application/json" },
        });
        setImmediate(() => {
          req.push(JSON.stringify({ input: { x: "a".repeat(200) } }));
          req.push(null);
        });
        await handlers.handleTask(req, res);
        expect(res.statusCode).toBe(413);
      } finally {
        await rr.dispose();
      }
    });

    it("handles multipart fileSize limit", async () => {
      const t = defineTask<any, Promise<string>>({
        id: "tests.security.limits.multipart",
        async run() {
          return "ok";
        },
      });
      const exposure = nodeExposure.with({
        http: {
          dangerouslyAllowOpenExposure: true,
          limits: { multipart: { fileSize: 10 } },
          auth: { allowAnonymous: true },
        },
      });
      const app = defineResource({
        id: "tests.app.security.limits.multipart",
        register: [t, exposure],
      });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const transport = createReqRes({
          url: `/__runner/task/${encodeURIComponent(t.id)}`,
          headers: { "content-type": "multipart/form-data; boundary=---X" },
        });
        setImmediate(() => {
          transport.req.push(
            '-----X\r\nContent-Disposition: form-data; name="file:F1"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nToo long for 10 bytes\r\n',
          );
          transport.req.push("-----X--\r\n");
          transport.req.push(null);
        });
        await handlers.handleTask(transport.req as any, transport.res as any);
        expect(transport.res.statusCode).toBe(413);
        expect(transport.json.error.message).toBe("File size limit exceeded");
      } finally {
        await rr.dispose();
      }
    });
  });

  describe("Error Masking", () => {
    it("masks internal error (500) messages", async () => {
      const t = defineTask<void, Promise<void>>({
        id: "tests.security.error.masking",
        async run() {
          throw new Error("SECRET_DATA");
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
        id: "tests.app.security.error.masking",
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
        expect(transport.json.error.message).toBe("Internal Error");
        expect(transport.text).not.toContain("SECRET");
      } finally {
        await rr.dispose();
      }
    });

    it("exposes typed error data if present", async () => {
      const MyError = error<{ reason: string }>("tests.errors.MyError").build();
      const t = defineTask<void, Promise<void>>({
        id: "tests.security.error.typed",
        async run() {
          MyError.throw({ reason: "valid" });
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
        id: "tests.app.security.error.typed",
        register: [t, exposure, MyError],
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
        expect(transport.json.error.data.reason).toBe("valid");
      } finally {
        await rr.dispose();
      }
    });

    it("allows message through for typed errors if format is used", async () => {
      const MyError = error<{ message: string }>("tests.errors.MyError")
        .format((d) => d.message)
        .build();
      const t = defineTask<void, Promise<void>>({
        id: "tests.security.error.typed2",
        async run() {
          MyError.throw({ message: "Safe User Message" });
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
        id: "tests.app.security.typed2",
        register: [t, exposure, MyError],
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
        expect(transport.json.error.message).toBe("Safe User Message");
      } finally {
        await rr.dispose();
      }
    });

    it("does not leak stack traces in 500 errors", async () => {
      const t = defineTask<void, Promise<void>>({
        id: "tests.security.error.stack",
        async run() {
          const err = new Error("Secret");
          (err as any).stack = "at secret (internal/secrets.ts:42)";
          throw err;
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
        id: "tests.app.security.error.stack",
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
        expect(transport.text).not.toContain("secrets.ts");
      } finally {
        await rr.dispose();
      }
    });

    it("uses INTERNAL_ERROR code when error has no code property", async () => {
      const t = defineTask<void, Promise<void>>({
        id: "tests.security.error.nocode",
        async run() {
          throw new Error("plain");
        },
      });
      const exposure = nodeExposure.with({
        http: {
          dangerouslyAllowOpenExposure: true,
          server: http.createServer(),
          auth: { allowAnonymous: true },
        },
      });
      const app = defineResource({
        id: "tests.app.security.error.nocode",
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
        expect(transport.json.error.code).toBe("INTERNAL_ERROR");
      } finally {
        await rr.dispose();
      }
    });

    it("masks multipart missing file error message", async () => {
      const t = defineTask<any, Promise<string>>({
        id: "tests.security.multipart.missingFile",
        async run() {
          return "ok";
        },
      });
      const exposure = nodeExposure.with({
        http: {
          dangerouslyAllowOpenExposure: true,
          server: http.createServer(),
          auth: { allowAnonymous: true },
        },
      });
      const app = defineResource({
        id: "tests.app.security.multipart.missingFile",
        register: [t, exposure],
      });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const transport = createReqRes({
          url: `/__runner/task/${encodeURIComponent(t.id)}`,
          headers: { "content-type": "multipart/form-data; boundary=---X" },
        });
        setImmediate(() => {
          const manifest = JSON.stringify({
            input: { myFile: { $runnerFile: "File", id: "F1" } },
          });
          transport.req.push(
            `-----X\r\nContent-Disposition: form-data; name="__manifest"\r\n\r\n${manifest}\r\n`,
          );
          transport.req.push("-----X--\r\n");
          transport.req.push(null);
        });
        await handlers.handleTask(transport.req as any, transport.res as any);
        expect(transport.res.statusCode).toBe(500);
        expect(transport.text).not.toContain("Missing file part");
      } finally {
        await rr.dispose();
      }
    });
  });

  describe("Cancellations", () => {
    it("JSON body: abort maps to 499 and task is not executed", async () => {
      let ran = false;
      const t = defineTask<{ x: number }, Promise<number>>({
        id: "tests.security.cancel.json",
        async run({ x }) {
          ran = true;
          return x + 1;
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
        id: "tests.app.security.cancel.json",
        register: [t, exposure],
      });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const transport = createReqRes({
          method: "POST",
          url: `/__runner/task/${encodeURIComponent(t.id)}`,
          headers: { "content-type": "application/json" },
        });
        setImmediate(() => transport.req.emit("aborted"));
        await handlers.handleTask(transport.req as any, transport.res as any);
        await new Promise((r) => setImmediate(r));
        expect(transport.res.statusCode).toBe(499);
        expect(transport.json.error.code).toBe("REQUEST_ABORTED");
        expect(ran).toBe(false);
      } finally {
        await rr.dispose();
      }
    });

    it("octet-stream: task throws CancellationError on signal → 499", async () => {
      const t = defineTask<void, Promise<void>>({
        id: "tests.security.cancel.octet",
        async run() {
          const { signal } = useExposureContext();
          if (signal.aborted)
            cancellationError.throw({ reason: "Client Closed Request" });
          await new Promise((_res, rej) => {
            signal.addEventListener(
              "abort",
              () =>
                rej(
                  (() => {
                    try {
                      cancellationError.throw({
                        reason: "Client Closed Request",
                      });
                    } catch (e) {
                      return e;
                    }
                  })(),
                ),
              { once: true },
            );
          });
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
        id: "tests.app.security.cancel.octet",
        register: [t, exposure],
      });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const transport = createReqRes({
          method: "POST",
          url: `/__runner/task/${encodeURIComponent(t.id)}`,
          headers: { "content-type": "application/octet-stream" },
        });
        setImmediate(() => transport.req.emit("aborted"));
        await handlers.handleTask(transport.req as any, transport.res as any);
        await new Promise((r) => setImmediate(r));
        expect(transport.res.statusCode).toBe(499);
        expect(transport.json.error.code).toBe("REQUEST_ABORTED");
      } finally {
        await rr.dispose();
      }
    });

    it("multipart: request error maps to 499 REQUEST_ABORTED", async () => {
      const t = defineTask<void, Promise<string>>({
        id: "tests.security.cancel.multipart",
        async run() {
          return "OK";
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
        id: "tests.app.security.cancel.multipart",
        register: [t, exposure],
      });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const transport = createReqRes({
          method: "POST",
          url: `/__runner/task/${encodeURIComponent(t.id)}`,
          headers: { "content-type": `multipart/form-data; boundary=----jest` },
        });
        setImmediate(() =>
          transport.req.emit("error", new Error("socket reset")),
        );
        await handlers.handleTask(transport.req as any, transport.res as any);
        await new Promise((r) => setImmediate(r));
        expect(transport.res.statusCode).toBe(499);
        expect(transport.json.error.code).toBe("REQUEST_ABORTED");
      } finally {
        await rr.dispose();
      }
    });
  });

  describe("Security Limits - Multipart Extras", () => {
    const getHandlersForLimits = async (limits: any) => {
      const t = defineTask<any, Promise<string>>({
        id: "t.lim",
        async run() {
          return "ok";
        },
      });
      const exposure = nodeExposure.with({
        http: {
          dangerouslyAllowOpenExposure: true,
          limits,
          auth: { allowAnonymous: true },
        },
      });
      const app = defineResource({ id: "app.lim", register: [t, exposure] });
      const rr = await run(app);
      const handlers = await rr.getResourceValue(exposure.resource as any);
      return { handlers, rr, tId: t.id };
    };

    it("handles multipart field limits", async () => {
      const { handlers, rr, tId } = await getHandlersForLimits({
        multipart: { fieldSize: 10 },
      });
      try {
        const transport = createReqRes({
          url: `/__runner/task/${encodeURIComponent(tId)}`,
          headers: { "content-type": "multipart/form-data; boundary=---X" },
        });
        setImmediate(() => {
          transport.req.push(
            '-----X\r\nContent-Disposition: form-data; name="__manifest"\r\n\r\n{ "input": {} }TOO_LONG\r\n-----X--',
          );
          transport.req.push(null);
        });
        await handlers.handleTask(transport.req as any, transport.res as any);
        expect(transport.res.statusCode).toBe(413);
        expect(transport.json.error.message).toBe("Field limit exceeded");
      } finally {
        await rr.dispose();
      }
    });

    it("handles multipart files limit", async () => {
      const { handlers, rr, tId } = await getHandlersForLimits({
        multipart: { files: 1 },
      });
      try {
        const transport = createReqRes({
          url: `/__runner/task/${encodeURIComponent(tId)}`,
          headers: { "content-type": "multipart/form-data; boundary=---X" },
        });
        setImmediate(() => {
          transport.req.push(
            '-----X\r\nContent-Disposition: form-data; name="file:F1"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\ncontent\r\n',
          );
          transport.req.push(
            '-----X\r\nContent-Disposition: form-data; name="file:F2"; filename="b.txt"\r\nContent-Type: text/plain\r\n\r\ncontent\r\n',
          );
          transport.req.push("-----X--\r\n");
          transport.req.push(null);
        });
        await handlers.handleTask(transport.req as any, transport.res as any);
        expect(transport.res.statusCode).toBe(413);
        expect(transport.json.error.message).toBe("Files limit exceeded");
      } finally {
        await rr.dispose();
      }
    });

    it("handles multipart parts limit", async () => {
      const { handlers, rr, tId } = await getHandlersForLimits({
        multipart: { parts: 1 },
      });
      try {
        const transport = createReqRes({
          url: `/__runner/task/${encodeURIComponent(tId)}`,
          headers: { "content-type": "multipart/form-data; boundary=---X" },
        });
        setImmediate(() => {
          transport.req.push(
            '-----X\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n',
          );
          transport.req.push(
            '-----X\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n',
          );
          transport.req.push("-----X--\r\n");
          transport.req.push(null);
        });
        await handlers.handleTask(transport.req as any, transport.res as any);
        expect(transport.res.statusCode).toBe(413);
        expect(transport.json.error.message).toBe("Parts limit exceeded");
      } finally {
        await rr.dispose();
      }
    });

    it("handles multipart fields limit", async () => {
      const { handlers, rr, tId } = await getHandlersForLimits({
        multipart: { fields: 1 },
      });
      try {
        const transport = createReqRes({
          url: `/__runner/task/${encodeURIComponent(tId)}`,
          headers: { "content-type": "multipart/form-data; boundary=---X" },
        });
        setImmediate(() => {
          transport.req.push(
            '-----X\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n',
          );
          transport.req.push(
            '-----X\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n',
          );
          transport.req.push("-----X--\r\n");
          transport.req.push(null);
        });
        await handlers.handleTask(transport.req as any, transport.res as any);
        expect(transport.res.statusCode).toBe(413);
        expect(transport.json.error.message).toBe("Fields limit exceeded");
      } finally {
        await rr.dispose();
      }
    });
  });
});
