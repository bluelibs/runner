import { resolveExecutionContextConfig } from "../../tools/resolveExecutionContextConfig";
import { EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS } from "../../types/executionContext";

describe("resolveExecutionContextConfig", () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
    });
  });

  it("returns null when executionContext is false", () => {
    expect(resolveExecutionContextConfig(false)).toBeNull();
  });

  it("returns defaults when executionContext is true", () => {
    const config = resolveExecutionContextConfig(true);

    expect(config?.frames).toBe("full");
    expect(config?.cycleDetection).toEqual(
      EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
    );
    expect(config?.createCorrelationId()).toEqual(expect.any(String));
  });

  it("uses default cycle detection when executionContext options omit it", () => {
    expect(resolveExecutionContextConfig({})).toEqual({
      createCorrelationId: expect.any(Function),
      frames: "full",
      cycleDetection: EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS,
    });
  });

  it("allows disabling cycle detection while keeping execution context", () => {
    expect(resolveExecutionContextConfig({ cycleDetection: false })).toEqual({
      createCorrelationId: expect.any(Function),
      frames: "full",
      cycleDetection: null,
    });
  });

  it('supports the lightweight "frames: off" mode', () => {
    expect(
      resolveExecutionContextConfig({
        frames: "off",
        cycleDetection: false,
      }),
    ).toEqual({
      createCorrelationId: expect.any(Function),
      frames: "off",
      cycleDetection: null,
    });
  });

  it('rejects "frames: off" when cycle detection stays enabled', () => {
    expect(() =>
      resolveExecutionContextConfig({
        frames: "off",
      }),
    ).toThrow('executionContext.frames "off" requires cycleDetection: false.');
  });

  it("merges custom cycle detection options", () => {
    expect(
      resolveExecutionContextConfig({
        cycleDetection: { maxDepth: 250 },
      }),
    ).toEqual({
      createCorrelationId: expect.any(Function),
      frames: "full",
      cycleDetection: {
        maxDepth: 250,
        maxRepetitions:
          EXECUTION_CONTEXT_CYCLE_DETECTION_DEFAULTS.maxRepetitions,
      },
    });
  });

  it("falls back when crypto.randomUUID is unavailable", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });

    const config = resolveExecutionContextConfig(true);
    const id = config?.createCorrelationId();

    expect(id).toMatch(/^exec-/);
  });
});
