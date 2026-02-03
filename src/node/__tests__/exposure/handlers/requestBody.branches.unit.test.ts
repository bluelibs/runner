import { readRequestBody } from "../../../exposure/requestBody";
import { cancellationError } from "../../../../errors";

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

function createOffOnlyReqStub(): {
  on: (event: string, cb: Function) => unknown;
  off: (event: string, cb: Function) => unknown;
  emit: (event: string, ...args: any[]) => void;
  offCalls: Array<{ event: string }>;
} {
  const listeners: Record<string, Function[]> = {};
  const offCalls: Array<{ event: string }> = [];

  return {
    on(event: string, cb: Function) {
      (listeners[event] = listeners[event] || []).push(cb);
      return this;
    },
    off(event: string, cb: Function) {
      offCalls.push({ event });
      const arr = listeners[event] || [];
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
      return this;
    },
    emit(event: string, ...args: any[]) {
      const arr = (listeners[event] || []).slice();
      for (const fn of arr) {
        (fn as any)(...args);
      }
    },
    offCalls,
  };
}

describe("requestBody branches", () => {
  it("already-aborted signal triggers immediate cancellation error (covers line 52)", async () => {
    const req = createReqStub();
    const ac = new AbortController();
    ac.abort();
    await expect(readRequestBody(req, ac.signal)).rejects.toMatchObject({
      name: "runner.errors.cancellation",
    });
  });

  it("abort then end calls onEnd but returns early due to aborted flag (covers line 27)", async () => {
    const req = createReqStub(true); // off is no-op so listeners remain
    const ac = new AbortController();
    const p = readRequestBody(req, ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({
      name: "runner.errors.cancellation",
    });
    // emit end afterwards; if onEnd runs, it should early-return and not throw
    req.emit("end");
  });

  it("coerces non-Error values thrown during abort handling", async () => {
    const req = createReqStub();
    const spy = jest
      .spyOn(cancellationError, "throw")
      .mockImplementation(() => {
        throw "boom";
      });

    const ac = new AbortController();
    ac.abort();
    await expect(readRequestBody(req, ac.signal)).rejects.toMatchObject({
      message: "boom",
    });

    spy.mockRestore();
  });

  it("coerces non-Error request errors into Error instances", async () => {
    const req = createReqStub();
    const p = readRequestBody(req);
    req.emit("error", "boom");
    await expect(p).rejects.toMatchObject({ message: "boom" });
  });

  it("preserves Error instances emitted from the request", async () => {
    const req = createReqStub();
    const p = readRequestBody(req);
    req.emit("error", new Error("boom"));
    await expect(p).rejects.toMatchObject({ message: "boom" });
  });

  it("ignores extra data chunks after aborting due to max size", async () => {
    const req = createReqStub(true); // off is no-op so listeners remain after cleanup
    const p = readRequestBody(req, undefined, 1);
    req.emit("data", Buffer.from("aa")); // exceeds max size => aborted = true
    req.emit("data", Buffer.from("bb")); // should hit `if (aborted) return;`
    await expect(p).rejects.toMatchObject({ message: "PAYLOAD_TOO_LARGE" });
  });

  it("uses req.off when removeListener is not available", async () => {
    const req = createOffOnlyReqStub();
    const ac = new AbortController();
    ac.abort();

    await expect(readRequestBody(req as any, ac.signal)).rejects.toMatchObject({
      name: "runner.errors.cancellation",
    });
    expect(req.offCalls.map((c) => c.event).sort()).toEqual([
      "aborted",
      "data",
      "end",
      "error",
    ]);
  });
});
