import { RemoteLaneTransportError } from "../../remote-lanes/http/protocol";
import {
  getRpcLaneRetryPolicyViolation,
  isRetryableRemoteLaneError,
  resolveRpcLaneRetryPolicy,
} from "../../remote-lanes/retry";

function transportError(
  code: string,
  extras?: { httpCode?: number; id?: string; data?: unknown },
): RemoteLaneTransportError {
  return new RemoteLaneTransportError(code, `${code} failure`, undefined, {
    httpCode: extras?.httpCode,
    id: extras?.id,
    data: extras?.data,
  });
}

describe("isRetryableRemoteLaneError", () => {
  it("rejects non-transport errors", () => {
    expect(isRetryableRemoteLaneError(new Error("boom"))).toBe(false);
    expect(isRetryableRemoteLaneError("boom")).toBe(false);
    expect(isRetryableRemoteLaneError(undefined)).toBe(false);
  });

  it("rejects typed domain errors that carry an error id", () => {
    expect(
      isRetryableRemoteLaneError(
        transportError("billing.insufficientFunds", {
          id: "billing.insufficientFunds",
          data: {},
        }),
      ),
    ).toBe(false);
  });

  it("retries timeout and connection failures", () => {
    expect(isRetryableRemoteLaneError(transportError("TIMEOUT"))).toBe(true);
    expect(isRetryableRemoteLaneError(transportError("REQUEST_TIMEOUT"))).toBe(
      true,
    );
    expect(isRetryableRemoteLaneError(transportError("NETWORK_ERROR"))).toBe(
      true,
    );
  });

  it("retries overload and gateway statuses", () => {
    for (const httpCode of [408, 429, 502, 503, 504]) {
      expect(
        isRetryableRemoteLaneError(transportError("HTTP_ERROR", { httpCode })),
      ).toBe(true);
    }
  });

  it("rejects definitive statuses and malformed responses", () => {
    for (const httpCode of [400, 401, 403, 404, 500]) {
      expect(
        isRetryableRemoteLaneError(transportError("HTTP_ERROR", { httpCode })),
      ).toBe(false);
    }
    expect(isRetryableRemoteLaneError(transportError("INVALID_RESPONSE"))).toBe(
      false,
    );
    expect(isRetryableRemoteLaneError(transportError("UNKNOWN"))).toBe(false);
  });

  it("rejects HTTP errors without a status code", () => {
    expect(isRetryableRemoteLaneError(transportError("HTTP_ERROR"))).toBe(
      false,
    );
  });
});

describe("resolveRpcLaneRetryPolicy", () => {
  it("applies transport-safe defaults", () => {
    const resolved = resolveRpcLaneRetryPolicy();
    expect(resolved.maxAttempts).toBe(3);
    expect(resolved.retryIf).toBe(isRetryableRemoteLaneError);
    expect(typeof resolved.delayMs).toBe("function");
    const delay = (resolved.delayMs as (attempt: number) => number)(0);
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThan(150);
  });

  it("keeps configured values", () => {
    const retryIf = () => true;
    const delayMs = (attempt: number) => attempt * 10;
    const resolved = resolveRpcLaneRetryPolicy({
      maxAttempts: 5,
      delayMs,
      retryIf,
    });
    expect(resolved.maxAttempts).toBe(5);
    expect(resolved.delayMs).toBe(delayMs);
    expect(resolved.retryIf).toBe(retryIf);
  });

  it("merges partial policies over defaults", () => {
    const resolved = resolveRpcLaneRetryPolicy({ maxAttempts: 1 });
    expect(resolved.maxAttempts).toBe(1);
    expect(resolved.retryIf).toBe(isRetryableRemoteLaneError);
    expect(typeof resolved.delayMs).toBe("function");
  });

  it("reports invalid fixed delays without rejecting delay strategies", () => {
    expect(getRpcLaneRetryPolicyViolation({ delayMs: -1 })).toEqual({
      field: "delayMs",
      value: "-1",
    });
    expect(
      getRpcLaneRetryPolicyViolation({ delayMs: Number.POSITIVE_INFINITY }),
    ).toEqual({ field: "delayMs", value: "Infinity" });
    expect(
      getRpcLaneRetryPolicyViolation({ delayMs: () => 0 }),
    ).toBeUndefined();
  });
});
