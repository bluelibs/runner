import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./security.test.utils";

describe("Security Limits - Multipart", () => {
  it("handles multipart field limits", async () => {
    const t = defineTask<any, Promise<string>>({ id: "tests.security.boundary.multipart.field", async run() { return "ok"; } });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, limits: { multipart: { fieldSize: 10 } }, auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.security.multipart.field", register: [t, exposure] });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({ url: `/__runner/task/${encodeURIComponent(t.id)}`, headers: { "content-type": "multipart/form-data; boundary=---X" } });
      setImmediate(() => {
        transport.req.push('-----X\r\nContent-Disposition: form-data; name="__manifest"\r\n\r\n{ "input": {} }TOO_LONG\r\n-----X--');
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
    const t = defineTask<any, Promise<string>>({ id: "tests.security.boundary.multipart.files", async run() { return "ok"; } });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, limits: { multipart: { files: 1 } }, auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.security.multipart.files", register: [t, exposure] });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({ url: `/__runner/task/${encodeURIComponent(t.id)}`, headers: { "content-type": "multipart/form-data; boundary=---X" } });
      setImmediate(() => {
        transport.req.push('-----X\r\nContent-Disposition: form-data; name="file:F1"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\ncontent\r\n');
        transport.req.push('-----X\r\nContent-Disposition: form-data; name="file:F2"; filename="b.txt"\r\nContent-Type: text/plain\r\n\r\ncontent\r\n');
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
    const t = defineTask<any, Promise<string>>({ id: "tests.security.boundary.multipart.parts", async run() { return "ok"; } });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, limits: { multipart: { parts: 1 } }, auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.security.multipart.parts", register: [t, exposure] });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({ url: `/__runner/task/${encodeURIComponent(t.id)}`, headers: { "content-type": "multipart/form-data; boundary=---X" } });
      setImmediate(() => {
        transport.req.push('-----X\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n');
        transport.req.push('-----X\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n');
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
    const t = defineTask<any, Promise<string>>({ id: "tests.security.boundary.multipart.fields", async run() { return "ok"; } });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, limits: { multipart: { fields: 1 } }, auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.security.multipart.fields", register: [t, exposure] });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({ url: `/__runner/task/${encodeURIComponent(t.id)}`, headers: { "content-type": "multipart/form-data; boundary=---X" } });
      setImmediate(() => {
        transport.req.push('-----X\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n');
        transport.req.push('-----X\r\nContent-Disposition: form-data; name="b"\r\n\r\n2\r\n');
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

  it("handles multipart file size limit", async () => {
    const t = defineTask<any, Promise<string>>({ id: "tests.security.boundary.multipart.fileSize", async run() { return "ok"; } });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, limits: { multipart: { fileSize: 10 } }, auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.security.multipart.fileSize", register: [t, exposure] });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({ url: `/__runner/task/${encodeURIComponent(t.id)}`, headers: { "content-type": "multipart/form-data; boundary=---X" } });
      setImmediate(() => {
        transport.req.push('-----X\r\nContent-Disposition: form-data; name="file:F1"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nThis is definitely longer than 10 bytes\r\n');
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
