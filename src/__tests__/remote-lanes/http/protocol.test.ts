import type { IEventEmission, ITask } from "../../../defs";
import {
  assertOkEnvelope,
  emitViaRemoteLane,
  RemoteLaneTransportError,
  runViaRemoteLane,
  toRemoteLaneTransportError,
} from "../../../remote-lanes/http/protocol";

describe("remote lanes http protocol", () => {
  it("returns result for ok envelopes", () => {
    expect(assertOkEnvelope({ ok: true, result: 42 })).toBe(42);
  });

  it("throws mapped transport errors for non-ok envelopes", () => {
    expect.assertions(4);

    try {
      assertOkEnvelope({ ok: false, error: { code: "X", message: "boom" } });
      fail("should throw");
    } catch (error) {
      const typedError = error as RemoteLaneTransportError;
      expect(error).toBeInstanceOf(RemoteLaneTransportError);
      expect(typedError.code).toBe("X");
      expect(typedError.message).toBe("boom");
      expect(typedError.name).toBe("RemoteLaneTransportError");
    }
  });

  it("uses fallback/default messages for invalid envelopes", () => {
    expect(() =>
      assertOkEnvelope(undefined, { fallbackMessage: "INVALID" }),
    ).toThrow("INVALID");
    expect(() => assertOkEnvelope(undefined)).toThrow(
      "Invalid or empty response",
    );
    expect(() => assertOkEnvelope({ ok: false } as any)).toThrow(
      "Remote lane transport error",
    );
  });

  it("maps unknown values to transport errors", () => {
    expect(toRemoteLaneTransportError(new Error("ERR")).message).toBe("ERR");
    expect(toRemoteLaneTransportError("weird").message).toBe("weird");
    expect(toRemoteLaneTransportError(123, "FB").message).toBe("FB");
    expect(toRemoteLaneTransportError(null).message).toBe(
      "Remote lane transport error",
    );
    expect(
      toRemoteLaneTransportError({ code: 123, message: "generic" }).message,
    ).toBe("generic");
    expect(
      toRemoteLaneTransportError({ message: 123 }, "fallback-non-string")
        .message,
    ).toBe("fallback-non-string");
  });

  it("maps protocol error metadata and fallback behavior", () => {
    const withMetadata = toRemoteLaneTransportError({
      code: "BAD_REQUEST",
      message: "bad",
      httpCode: 400,
      id: "tests-error-id",
      data: { code: 12 },
    });
    expect(withMetadata).toMatchObject({
      code: "BAD_REQUEST",
      httpCode: 400,
      id: "tests-error-id",
      data: { code: 12 },
      message: "bad",
    });

    const emptyMessageWithFallback = toRemoteLaneTransportError(
      { code: "E", message: "" },
      "FALLBACK",
    );
    expect(emptyMessageWithFallback.message).toBe("FALLBACK");

    const emptyMessageWithoutFallback = toRemoteLaneTransportError({
      code: "E",
      message: "",
    });
    expect(emptyMessageWithoutFallback.message).toBe(
      "Remote lane transport error",
    );
  });

  it("delegates run and emit helpers to runner callbacks", async () => {
    const runCalls: Array<{ taskId: string; input: unknown }> = [];
    const emitCalls: Array<{ id: string; data: unknown }> = [];
    const task = { id: "tests-remote-lanes-protocol-task" } as ITask<
      any,
      any,
      any,
      any,
      any,
      any
    >;
    const emission = {
      id: "tests-remote-lanes-protocol-event",
      data: { x: 1 },
    } as IEventEmission<any>;

    const runResult = await runViaRemoteLane(
      async (candidateTask, input) => {
        runCalls.push({ taskId: candidateTask.id, input });
        return 7;
      },
      task,
      { a: 1 },
    );

    await emitViaRemoteLane(async (payload) => {
      emitCalls.push(payload as { id: string; data: unknown });
      return undefined;
    }, emission);

    expect(runResult).toBe(7);
    expect(runCalls).toEqual([
      { taskId: "tests-remote-lanes-protocol-task", input: { a: 1 } },
    ]);
    expect(emitCalls).toEqual([
      { id: "tests-remote-lanes-protocol-event", data: { x: 1 } },
    ]);
  });
});
