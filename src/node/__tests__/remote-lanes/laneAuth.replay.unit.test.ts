import { createRemoteLaneReplayProtector } from "../../remote-lanes/laneAuth";

function expectRunnerErrorId(fn: () => unknown, errorId: string): void {
  try {
    fn();
    throw new Error(`Expected RunnerError "${errorId}"`);
  } catch (error) {
    const candidate = error as { id?: string; name?: string };
    expect(candidate.id ?? candidate.name).toBe(errorId);
  }
}

describe("laneAuth replay protector", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows expired entries to be pruned and reused", () => {
    const protector = createRemoteLaneReplayProtector();
    jest.spyOn(Date, "now").mockReturnValue(100);
    protector.markOrThrow("jti-1", 150, "lane-a");

    jest.spyOn(Date, "now").mockReturnValue(200);
    expect(() => protector.markOrThrow("jti-1", 250, "lane-a")).not.toThrow();
  });

  it("rejects replayed entries before they expire", () => {
    const protector = createRemoteLaneReplayProtector();
    jest.spyOn(Date, "now").mockReturnValue(100);
    protector.markOrThrow("jti-1", 150, "lane-a");

    expectRunnerErrorId(
      () => protector.markOrThrow("jti-1", 150, "lane-a"),
      "remoteLanes-auth-unauthorized",
    );
  });

  it("evicts the oldest entry when the bounded cache overflows", () => {
    const protector = createRemoteLaneReplayProtector(1);
    jest.spyOn(Date, "now").mockReturnValue(100);
    protector.markOrThrow("jti-1", 1_000, "lane-a");
    protector.markOrThrow("jti-2", 1_000, "lane-a");

    expect(() => protector.markOrThrow("jti-1", 1_000, "lane-a")).not.toThrow();
  });

  it("keeps running when the oldest bounded key is a falsy empty string", () => {
    const protector = createRemoteLaneReplayProtector(0);
    jest.spyOn(Date, "now").mockReturnValue(100);

    expect(() => protector.markOrThrow("", 1_000, "lane-a")).not.toThrow();
    expect(() => protector.markOrThrow("next", 1_000, "lane-a")).not.toThrow();
  });
});
