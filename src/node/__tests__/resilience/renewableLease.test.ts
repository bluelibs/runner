import { createRenewableLease } from "../../resilience/renewableLease";

function fixture() {
  const renew = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);
  const release = jest.fn(async () => {});
  const onLoss = jest.fn();
  const lease = createRenewableLease({
    leaseMs: 90,
    leaseDeadline: performance.now() + 90,
    renew,
    release,
    onLoss,
    errors: {
      lost: () => new Error("expired"),
      beforeExecution: () => new Error("expired before execution"),
      beforeCompletion: () => new Error("expired before completion"),
      renewal: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    },
  });
  return { lease, renew, release, onLoss };
}

describe("shared renewable lease", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("invalidates once, rejects future work, and stops touching the backend after release", async () => {
    const { lease, renew, onLoss } = fixture();
    const error = new Error("ownership lost");
    lease.fail(error);
    lease.fail(new Error("second failure"));
    expect(() => lease.assertActive()).toThrow(error);
    await expect(lease.assertOwnership()).rejects.toThrow(error);
    await expect(lease.lost).rejects.toThrow(error);
    expect(onLoss).toHaveBeenCalledTimes(1);
    await lease.release();
    expect(renew).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    const released = fixture();
    await released.lease.release();
    released.lease.fail(error);
    await released.lease.assertOwnership();
    expect(released.onLoss).not.toHaveBeenCalled();
    expect(released.renew).not.toHaveBeenCalled();
  });

  it("rejects a successful verification response if ownership was lost while it was pending", async () => {
    const { lease, renew } = fixture();
    let respond!: (renewed: boolean) => void;
    renew.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const failure = lease.assertOwnership().catch((error: unknown) => error);
    lease.fail(new Error("invalidated during verification"));
    respond(true);
    expect(await failure).toMatchObject({
      message: "invalidated during verification",
    });
    await lease.release();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not restart renewal after a delayed response to an invalidated lease", async () => {
    const { lease, renew } = fixture();
    let respond!: (renewed: boolean) => void;
    renew.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    await jest.advanceTimersByTimeAsync(30);
    lease.fail(new Error("invalidated"));
    respond(true);
    await jest.advanceTimersByTimeAsync(100);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    await lease.release();
  });
  it("releases before a stalled renewal responds and ignores its late success", async () => {
    const { lease, renew, release } = fixture();
    let respond!: (renewed: boolean) => void;
    renew.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    await jest.advanceTimersByTimeAsync(30);
    await jest.advanceTimersByTimeAsync(60);
    const cleanup = lease.release();
    await jest.advanceTimersByTimeAsync(0);
    try {
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      respond(true);
      await cleanup;
    }
    await jest.advanceTimersByTimeAsync(100);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
