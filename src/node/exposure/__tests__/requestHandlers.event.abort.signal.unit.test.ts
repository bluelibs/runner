import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";

function createReqStub(): any {
  const listeners: Record<string, Function[]> = {};
  return {
    method: "POST",
    url: "/api/event/e.id",
    headers: { "content-type": "application/json" },
    on(event: string, cb: Function) {
      (listeners[event] = listeners[event] || []).push(cb);
      return this;
    },
    once(event: string, cb: Function) {
      const wrapper = (...args: any[]) => {
        cb(...args);
        const arr = listeners[event] || [];
        const i = arr.indexOf(wrapper);
        if (i >= 0) arr.splice(i, 1);
      };
      (listeners[event] = listeners[event] || []).push(wrapper);
      return this;
    },
    off(event: string, cb: Function) {
      const arr = listeners[event] || [];
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
      return this;
    },
    removeListener(event: string, cb: Function) {
      return (this as any).off(event, cb);
    },
    emit(event: string, ...args: any[]) {
      const arr = (listeners[event] || []).slice();
      for (const fn of arr) {
        try {
          (fn as any)(...args);
        } catch {}
      }
    },
  } as unknown as IncomingMessage;
}

function createResStub(): any {
  const res: any = {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    setHeader() {
      this.headersSent = true;
    },
    once(event: string, cb: Function) {
      if (event === "close") setImmediate(() => cb());
      return this;
    },
    on() {
      return this;
    },
    end(buf?: any) {
      this.writableEnded = true;
      this._buf = buf;
    },
  };
  return res as ServerResponse & { _buf?: Buffer };
}

describe("requestHandlers - event abort via req 'aborted' signal", () => {
  it("calls onAbortEvt and responds 499", async () => {
    const deps: any = {
      store: { events: new Map([["e.id", { event: { id: "e.id" } }]]) },
      taskRunner: {} as any,
      eventManager: { emit: async () => {} },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "event", id: "e.id" }),
        isUnderBase: () => true,
      },
      cors: undefined,
    };

    const { handleEvent } = createRequestHandlers(deps);
    const req = createReqStub();
    const res = createResStub();

    // Emit aborted right after handler starts
    setImmediate(() => (req as any).emit("aborted"));

    await handleEvent(req, res);
    const payload = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect(payload?.error?.code).toBe("REQUEST_ABORTED");
  });
});
