import * as http from "http";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { error } from "../../../../definers/builders/error";
import { createReqRes } from "./security.test.utils";

describe("Error Security Fixes", () => {
  it("masks internal error (500) messages", async () => {
    const t = defineTask<void, Promise<void>>({
      id: "tests.security.error.masking",
      async run() {
        throw new Error("SECRET_DATABASE_INFO");
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
      id: "tests.app.security.masking",
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

  it("exposes typed error messages if appErrorExtra is present", async () => {
    const MyError = error<{ reason: string }>("tests.errors.MyError").build();

    const t = defineTask<void, Promise<void>>({
      id: "tests.security.error.typed",
      async run() {
        MyError.throw({ reason: "valid reason" });
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
      id: "tests.app.security.typed",
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
      expect(transport.json.error.code).toBe("INTERNAL_ERROR");
      expect(transport.json.error.data.reason).toBe("valid reason");
    } finally {
      await rr.dispose();
    }
  });
});

describe("Typed Error Security", () => {
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
});

describe("Error Sanitization Security Coverage", () => {
  it("does not leak stack traces in 500 errors", async () => {
    const t = defineTask<void, Promise<void>>({
      id: "tests.security.error.stack",
      async run() {
        const err = new Error("Secret internal error");
        (err as any).stack = "at secretFunction (internal/secrets.ts:42)";
        (err as any).cause = { sql: "SELECT * FROM passwords" };
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
      expect(transport.json.error.message).toBe("Internal Error");
      // Ensure sensitive data is not leaked
      expect(transport.text).not.toContain("secretFunction");
      expect(transport.text).not.toContain("secrets.ts");
      expect(transport.text).not.toContain("passwords");
      expect(transport.text).not.toContain("cause");
      expect(transport.text).not.toContain("stack");
    } finally {
      await rr.dispose();
    }
  });

  it("uses INTERNAL_ERROR code when error has no code property", async () => {
    const t = defineTask<void, Promise<void>>({
      id: "tests.security.error.nocode",
      async run() {
        throw new Error("plain error without code");
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
      expect(transport.json.error.message).toBe("Internal Error");
    } finally {
      await rr.dispose();
    }
  });

  it("masks multipart missing file error message", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.boundary.multipart.missingFile",
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
      expect(transport.json.error.message).toBe("Internal Error");
      expect(transport.text).not.toContain("Missing file part");
    } finally {
      await rr.dispose();
    }
  });
});
