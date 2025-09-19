import {
  assertOkEnvelope,
  toTunnelError,
  TunnelError,
} from "../../globals/resources/tunnel/protocol";

describe("tunnel protocol", () => {
  test("assertOkEnvelope returns result on ok", () => {
    expect(assertOkEnvelope({ ok: true, result: 42 })).toBe(42);
  });

  test("assertOkEnvelope throws TunnelError on not ok", () => {
    try {
      assertOkEnvelope({ ok: false, error: { code: "X", message: "boom" } });
      fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TunnelError);
      expect((e as TunnelError).code).toBe("X");
      expect((e as Error).message).toBe("boom");
    }
  });

  test("toTunnelError maps unknown to UNKNOWN", () => {
    const err = toTunnelError("weird");
    expect(err).toBeInstanceOf(TunnelError);
    expect(err.code).toBe("UNKNOWN");
  });
});
