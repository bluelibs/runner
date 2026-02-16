import { EventEmitter } from "events";
import { cancellationError } from "../../../errors";
import { createAbortControllerForRequest } from "../../exposure/utils";

describe("node exposure utils", () => {
  const originalAbortController = globalThis.AbortController;

  afterEach(() => {
    jest.restoreAllMocks();
    (
      globalThis as { AbortController: typeof AbortController }
    ).AbortController = originalAbortController;
  });

  it("logs when request abort signaling throws an Error", () => {
    class ThrowingAbortController {
      signal = {} as AbortSignal;

      abort(): void {
        throw new Error("abort failed");
      }
    }

    (
      globalThis as { AbortController: typeof AbortController }
    ).AbortController =
      ThrowingAbortController as unknown as typeof AbortController;

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

    (
      globalThis as { AbortController: typeof AbortController }
    ).AbortController =
      ThrowingAbortController as unknown as typeof AbortController;

    jest.spyOn(cancellationError, "throw").mockImplementation(() => {
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
});
