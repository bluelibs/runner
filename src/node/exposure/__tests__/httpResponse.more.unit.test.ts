import { respondStream } from "../httpResponse";

describe("httpResponse additional branch coverage", () => {
  it("respondStream drains via sync read() and ends without listeners", () => {
    const writes: Buffer[] = [];
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      setHeader() {},
      write(payload?: unknown) {
        if (payload == null) return;
        writes.push(
          Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
        );
      },
      end() {
        this.writableEnded = true;
      },
    };

    // Minimal stream-like object exposing a synchronous read that returns a chunk then null
    const inner: any = {
      _calls: 0,
      readableEnded: true,
      read() {
        return this._calls++ === 0 ? Buffer.from("R1", "utf8") : null;
      },
    };

    respondStream(res as any, { stream: inner } as any);
    expect(Buffer.concat(writes).toString("utf8")).toBe("R1");
    expect(res.writableEnded).toBe(true);
    // No event listener API was required; ensure stream still has no 'on'
    expect((inner as any).on).toBeUndefined();
  });

  it("respondStream calls resume() when attaching listeners for async flow", async () => {
    const writes: Buffer[] = [];
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      setHeader() {},
      write(payload?: unknown) {
        if (payload == null) return;
        writes.push(
          Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
        );
      },
      end() {
        this.writableEnded = true;
      },
    };

    // Stream with event API and a resume() method to cover that branch
    const listeners: Record<string, Function[]> = {};
    const emit = (ev: string, arg?: unknown) => {
      for (const fn of listeners[ev] ?? []) fn(arg);
    };
    const resume = jest.fn();
    const off = jest.fn();
    const inner: any = {
      on(ev: string, cb: Function) {
        (listeners[ev] ||= []).push(cb);
        return inner;
      },
      once(ev: string, cb: Function) {
        (listeners[ev] ||= []).push(cb);
        return inner;
      },
      off,
      resume,
    };

    respondStream(res as any, { stream: inner } as any);
    expect(resume).toHaveBeenCalled();
    emit.call(inner, "data", Buffer.from("A", "utf8"));
    emit.call(inner, "end");
    await new Promise((r) => setImmediate(r));
    expect(res.writableEnded).toBe(true);
    expect(Buffer.concat(writes).toString("utf8")).toBe("A");
    expect(off).toHaveBeenCalledWith("data", expect.any(Function));
  });

  it("respondStream ends immediately when _readableState.ended is true after sync read()", () => {
    const writes: Buffer[] = [];
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      setHeader() {},
      write(payload?: unknown) {
        if (payload == null) return;
        writes.push(
          Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
        );
      },
      end() {
        this.writableEnded = true;
      },
    };

    const inner: any = {
      _calls: 0,
      _readableState: { ended: true },
      read() {
        // return null immediately so the code checks _readableState.ended
        return null;
      },
    };

    respondStream(res as any, { stream: inner } as any);
    expect(res.writableEnded).toBe(true);
    expect(Buffer.concat(writes).length).toBe(0);
  });

  it("respondStream tolerates missing res.write via optional chaining in handleData", async () => {
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      setHeader() {},
      end() {
        this.writableEnded = true;
      },
    };

    const listeners: Record<string, Function[]> = {};
    const inner: any = {
      on(ev: string, cb: Function) {
        (listeners[ev] ||= []).push(cb);
        return inner;
      },
      once(ev: string, cb: Function) {
        (listeners[ev] ||= []).push(cb);
        return inner;
      },
    };

    respondStream(res as any, { stream: inner } as any);
    // Emit a non-buffer chunk to exercise the String() conversion and optional write
    for (const fn of listeners["data"] ?? []) fn("Z");
    for (const fn of listeners["end"] ?? []) fn();
    await new Promise((r) => setImmediate(r));
    expect(res.writableEnded).toBe(true);
  });
});
