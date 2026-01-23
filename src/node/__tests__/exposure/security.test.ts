import * as http from "http";
import { Readable } from "stream";
import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { nodeExposure } from "../../exposure/resource";
import { error } from "../../../definers/builders/error";

function createReqRes(init: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}) {
  const { method = "POST", url = "/", headers = {}, body } = init;
  const req = new Readable({
    read() {},
  }) as any;
  req.method = method;
  req.url = url;
  req.headers = headers;

  const originalPush = req.push.bind(req);
  req.push = (chunk: any) => {
    if (chunk === null) {
      originalPush(null);
    } else {
      originalPush(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
  };

  if (body != null) {
    setImmediate(() => {
      req.push(body);
      req.push(null);
    });
  }

  const chunks: Buffer[] = [];
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    headersSent: false,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return this.headers[k.toLowerCase()];
    },
    write(payload?: any) {
      if (payload != null)
        chunks.push(
          Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
        );
      this.headersSent = true;
    },
    end(payload?: any) {
      if (payload != null) this.write(payload);
      this.headersSent = true;
      this.writableEnded = true;
    },
  };

  return {
    req,
    res,
    get text() {
      return Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8");
    },
    get json() {
      return JSON.parse(this.text);
    },
    get headers() {
      return res.headers as Record<string, string>;
    },
  };
}

describe("Security Fixes", () => {
  it("rejects JSON body > 2MB with 413", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.json",
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
      id: "tests.app.security.json",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);

      // Create a body larger than 2MB
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

describe("Boundary Security Coverage", () => {
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

  it("handles multipart field limits", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.boundary.multipart.field",
      async run() {
        return "ok";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        limits: { multipart: { fieldSize: 10 } },
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.security.multipart.field",
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

  it("handles requestBody multi-chunk abortion", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.boundary.json.abort",
      async run() {
        return "ok";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        limits: { json: { maxSize: 10 } },
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.security.body.abort",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: { "content-type": "application/json" },
      });

      setImmediate(() => {
        transport.req.push('{ "a": ');
        transport.req.push(
          '"Too many characters in this string to fit in 10 bytes"',
        );
        transport.req.push(" }"); // This should hit the 'if (aborted) return'
        transport.req.push(null);
      });

      await handlers.handleTask(transport.req as any, transport.res as any);
      expect(transport.res.statusCode).toBe(413);
    } finally {
      await rr.dispose();
    }
  });

  it("handles multipart files limit", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.boundary.multipart.files",
      async run() {
        return "ok";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        limits: { multipart: { files: 1 } },
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.security.multipart.files",
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
        // One file is ok
        transport.req.push(
          '-----X\r\nContent-Disposition: form-data; name="file:F1"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\ncontent\r\n',
        );
        // Second file should hit limit
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
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.boundary.multipart.parts",
      async run() {
        return "ok";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        limits: { multipart: { parts: 1 } },
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.security.multipart.parts",
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
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.boundary.multipart.fields",
      async run() {
        return "ok";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        limits: { multipart: { fields: 1 } },
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.security.multipart.fields",
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

  it("handles multipart file size limit event", async () => {
    const t = defineTask<any, Promise<string>>({
      id: "tests.security.boundary.multipart.fileSize",
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
      id: "tests.app.security.multipart.fileSize",
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
          '-----X\r\nContent-Disposition: form-data; name="file:F1"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nThis is definitely longer than 10 bytes\r\n',
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
        // Manifest says we have a file:F1
        const manifest = JSON.stringify({
          input: { myFile: { $runnerFile: "File", id: "F1" } },
        });
        transport.req.push(
          `-----X\r\nContent-Disposition: form-data; name="__manifest"\r\n\r\n${manifest}\r\n`,
        );
        // But we never send file:F1 and just end the request
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

describe("Error Sanitization Security", () => {
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
});

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
