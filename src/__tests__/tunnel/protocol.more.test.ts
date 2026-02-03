import {
  assertOkEnvelope,
  toTunnelError,
  TunnelError,
} from "../../globals/resources/tunnel/protocol";

describe("tunnel protocol - more branches", () => {
  it("toTunnelError handles Error instance", () => {
    const e = new Error("ERR");
    const te = toTunnelError(e);
    expect(te).toBeInstanceOf(TunnelError);
    expect(te.message).toBe("ERR");
    expect(te.code).toBe("UNKNOWN");
  });

  it("toTunnelError handles plain object with message only", () => {
    const te = toTunnelError({ message: "M" } as unknown as Error);
    expect(te).toBeInstanceOf(TunnelError);
    expect(te.message).toBe("M");
    expect(te.code).toBe("UNKNOWN");
  });

  it("assertOkEnvelope uses fallback when error missing", () => {
    expect(() =>
      assertOkEnvelope({ ok: false } as unknown as { ok: boolean }, {
        fallbackMessage: "FB",
      }),
    ).toThrow(/FB/);
  });

  it("assertOkEnvelope invalid input uses fallback message when provided", () => {
    try {
      assertOkEnvelope(undefined as unknown as { ok: boolean }, {
        fallbackMessage: "INVALID",
      });
      fail("should throw");
    } catch (e) {
      expect((e as Error).message).toBe("INVALID");
    }
  });

  it("toTunnelError prefers fallback when protocol error has empty message", () => {
    const te = toTunnelError(
      { code: "C", message: "" } as unknown as Error,
      "FALLBACK",
    );
    expect(te).toBeInstanceOf(TunnelError);
    expect(te.code).toBe("C");
    expect(te.message).toBe("FALLBACK");
  });

  it("toTunnelError returns string message when input is string, ignoring fallback", () => {
    const te = toTunnelError("STR", "IGNORED");
    expect(te.message).toBe("STR");
    expect(te.code).toBe("UNKNOWN");
  });
});
