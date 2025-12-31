jest.mock("../multipart", () => {
  return {
    isMultipart: () => true,
    parseMultipartInput: async () => ({
      ok: true as const,
      value: { some: "input" },
      finalize: Promise.resolve({ ok: true as const }),
    }),
  };
});

import { createRequestHandlers } from "../requestHandlers";
import { getDefaultSerializer } from "../../../serializer";
import { createRouter } from "../router";

describe("requestHandlers multipart rethrow after finalize", () => {
  it("rethrows task error after successful finalize and responds 500", async () => {
    const store: any = {
      tasks: new Map([["t", { task: { id: "t" } }]]),
      events: new Map(),
    };
    const taskRunner = {
      run: async () => {
        throw new Error("task-bad");
      },
    } as any;
    const eventManager: any = { emit: async () => {} };
    const logger: any = {
      error: () => {},
      info: () => {},
    };
    const authenticator = () => ({ ok: true as const });
    const allowList = {
      ensureTask: () => null,
      ensureEvent: () => null,
    } as any;
    const router = createRouter("/__runner");

    const { handleTask } = createRequestHandlers({
      store,
      taskRunner: taskRunner as any,
      eventManager: eventManager as any,
      logger: logger as any,
      authenticator: authenticator as any,
      allowList,
      router,
      serializer: getDefaultSerializer(),
    });

    const req: any = {
      method: "POST",
      url: "/__runner/task/t",
      headers: { "content-type": "multipart/form-data; boundary=X" },
      on() {
        return req;
      },
    };
    const chunks: Buffer[] = [];
    let status = 0;
    const res: any = {
      statusCode: 0,
      setHeader() {},
      end(payload?: any) {
        status = this.statusCode;
        if (payload != null)
          chunks.push(
            Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
          );
      },
    };

    await handleTask(req, res);
    const serializer = getDefaultSerializer();
    const body = chunks.length
      ? (serializer.parse(
          Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8"),
        ) as any)
      : undefined;
    expect(status).toBe(500);
    expect(body?.error?.message).toBe("task-bad");
  });
});
