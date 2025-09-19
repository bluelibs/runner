import { readRequestBody } from "../../exposure/requestBody";

function createReqStub(noopOff = false) {
  const listeners: Record<string, Function[]> = {};
  return {
    on(event: string, cb: Function) {
      (listeners[event] = listeners[event] || []).push(cb);
      return this;
    },
    once(event: string, cb: Function) {
      (listeners[event] = listeners[event] || []).push(cb);
      return this;
    },
    off(event: string, cb: Function) {
      if (noopOff) return this; // simulate environments where off is a no-op
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
  } as any;
}

describe("requestBody branches", () => {
  it("already-aborted signal triggers immediate CancellationError (covers line 52)", async () => {
    const req = createReqStub();
    const ac = new AbortController();
    ac.abort();
    await expect(readRequestBody(req, ac.signal)).rejects.toMatchObject({
      name: "CancellationError",
    });
  });

  it("abort then end calls onEnd but returns early due to aborted flag (covers line 27)", async () => {
    const req = createReqStub(true); // off is no-op so listeners remain
    const ac = new AbortController();
    const p = readRequestBody(req, ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "CancellationError" });
    // emit end afterwards; if onEnd runs, it should early-return and not throw
    req.emit("end");
  });
});
