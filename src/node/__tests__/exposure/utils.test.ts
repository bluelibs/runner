import { EventEmitter } from "events";
import { cancellationError, createMessageError } from "../../../errors";
import { createAbortControllerForRequest } from "../../exposure/utils";

describe("node exposure utils", () => {
  const originalAbortController = globalThis.AbortController;

  afterEach(() => {
    jest.restoreAllMocks();
    Object.assign(globalThis, { AbortController: originalAbortController });
  });

  it("logs when request abort signaling throws an Error", () => {
    class ThrowingAbortController {
      signal = {} as AbortSignal;

      abort(): void {
        throw createMessageError("abort failed");
      }
    }

    Object.assign(globalThis, { AbortController: ThrowingAbortController });

    const req = new EventEmitter();
    const res = new EventEmitter();
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    createAbortControllerForRequest(req as any, res as any);
    req.emit("aborted");

    expect(consoleSpy).toHaveBeenCalledWith(
      "[runner] Failed to abort request controller.",
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it("normalizes non-Error cancellation and abort failures", () => {
    class ThrowingAbortController {
      signal = {} as AbortSignal;

      abort(): void {
        throw "abort failed";
      }
    }

    Object.assign(globalThis, { AbortController: ThrowingAbortController });

    const errorHelperPrototype = Object.getPrototypeOf(cancellationError) as {
      throw: (...args: any[]) => never;
    };
    const originalThrow = errorHelperPrototype.throw;
    jest.spyOn(errorHelperPrototype, "throw").mockImplementation(function (
      this: unknown,
      ...args: any[]
    ) {
      if (this !== cancellationError) {
        return originalThrow.call(this, ...args);
      }
      throw "cancel failed";
    });
    const req = new EventEmitter();
    const res = new EventEmitter();
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    createAbortControllerForRequest(req as any, res as any);
    res.emit("close");

    expect(consoleSpy).toHaveBeenCalledWith(
      "[runner] Failed to abort request controller.",
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it("does not abort on normal response finish followed by close", () => {
    const abort = jest.fn();
    class SpyAbortController {
      signal = { aborted: false } as AbortSignal;
      abort = abort;
    }
    Object.assign(globalThis, { AbortController: SpyAbortController });

    const req = new EventEmitter();
    const res = Object.assign(new EventEmitter(), {
      writableEnded: true,
      writableFinished: true,
    });

    createAbortControllerForRequest(req as any, res as any);
    res.emit("finish");
    res.emit("close");

    expect(abort).not.toHaveBeenCalled();
  });

  it("ignores duplicate abort signals after the controller is already aborted", () => {
    let aborted = false;
    const abort = jest.fn(() => {
      aborted = true;
    });
    class SpyAbortController {
      signal = {
        get aborted() {
          return aborted;
        },
      } as AbortSignal;
      abort = abort;
    }
    Object.assign(globalThis, { AbortController: SpyAbortController });

    const req = new EventEmitter();
    const res = new EventEmitter();

    createAbortControllerForRequest(req as any, res as any);
    req.emit("aborted");
    req.emit("aborted");

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("short-circuits repeated abort callbacks when a request exposes only `on`", () => {
    let aborted = false;
    const abort = jest.fn(() => {
      aborted = true;
    });
    class SpyAbortController {
      signal = {
        get aborted() {
          return aborted;
        },
      } as AbortSignal;
      abort = abort;
    }
    Object.assign(globalThis, { AbortController: SpyAbortController });

    const reqHandlers: Record<string, (...args: unknown[]) => void> = {};
    const resHandlers: Record<string, (...args: unknown[]) => void> = {};
    const req = {
      on: (event: string, handler: (...args: unknown[]) => void) => {
        reqHandlers[event] = handler;
      },
    };
    const res = {
      writableEnded: false,
      writableFinished: false,
      on: (event: string, handler: (...args: unknown[]) => void) => {
        resHandlers[event] = handler;
      },
    };

    createAbortControllerForRequest(req as any, res as any);
    reqHandlers.aborted?.();
    reqHandlers.aborted?.();

    expect(abort).toHaveBeenCalledTimes(1);
  });
});
