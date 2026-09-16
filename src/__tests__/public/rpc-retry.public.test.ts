import {
  RemoteLaneTransportError,
  createRetryingRpcLaneCommunicator,
  isRetryableRemoteLaneError,
} from "../../public";

describe("public rpc retry helpers", () => {
  it("exposes the retry decorator, classifier, and transport error", () => {
    expect(typeof createRetryingRpcLaneCommunicator).toBe("function");
    expect(typeof isRetryableRemoteLaneError).toBe("function");
    expect(typeof RemoteLaneTransportError).toBe("function");
    expect(
      isRetryableRemoteLaneError(
        new RemoteLaneTransportError("TIMEOUT", "slow"),
      ),
    ).toBe(true);
  });
});
