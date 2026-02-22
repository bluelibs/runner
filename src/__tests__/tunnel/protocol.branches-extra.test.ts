import {
  assertOkEnvelope,
  toTunnelError,
  TunnelError,
} from "../../globals/resources/tunnel/protocol";

describe("tunnel protocol - branches extra", () => {
  it("assertOkEnvelope throws INVALID_RESPONSE with default message when envelope is not object", () => {
    expect.assertions(2);
    try {
      assertOkEnvelope(undefined);
      fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TunnelError);
      expect((e as TunnelError).code).toBe("INVALID_RESPONSE");
    }
  });

  it("toTunnelError uses fallback when non-string thrown value provided and no message", () => {
    const te = toTunnelError(123, "FALL");
    expect(te).toBeInstanceOf(TunnelError);
    expect(te.message).toBe("FALL");
  });

  it("toTunnelError uses default message when protocol error has empty message and no fallback", () => {
    const te = toTunnelError({ code: "C", message: "" });
    expect(te).toBeInstanceOf(TunnelError);
    expect(te.code).toBe("C");
    expect(te.message).toBe("Tunnel error");
  });

  it("assertOkEnvelope not ok and no error and no fallback uses default message", () => {
    expect.assertions(1);
    try {
      assertOkEnvelope({ ok: false } as any);
      fail("should throw");
    } catch (e) {
      expect((e as TunnelError).message).toMatch(/Tunnel error/);
    }
  });

  it("toTunnelError handles null input with default message", () => {
    const te = toTunnelError(null);
    expect(te).toBeInstanceOf(TunnelError);
    expect(te.message).toBe("Tunnel error");
  });

  it("toTunnelError falls back when protocol message is not a string", () => {
    const te = toTunnelError({ code: "E", message: 123 } as any, "fallback");
    expect(te.message).toBe("fallback");
  });

  it("toTunnelError reads generic object message when no protocol code is present", () => {
    const te = toTunnelError({ message: "generic-object-error" });
    expect(te.code).toBe("UNKNOWN");
    expect(te.message).toBe("generic-object-error");
  });
});
