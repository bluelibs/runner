import { detectRunnerMode } from "../../tools/detectRunnerMode";
import { RunnerMode } from "../../types/runner";
import { setPlatform, resetPlatform } from "../../platform";
import { PlatformAdapter } from "../../platform";

describe("detectRunnerMode Utility", () => {
  beforeEach(() => {
    resetPlatform();
  });

  afterEach(() => {
    resetPlatform();
  });

  it("should return explicit mode when provided", () => {
    const result = detectRunnerMode(RunnerMode.PROD);
    expect(result).toBe(RunnerMode.PROD);
  });

  it("should auto-detect mode from environment when not provided", () => {
    const mockAdapter = new PlatformAdapter();

    // Test PROD mode
    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "production";
      return undefined;
    });

    setPlatform(mockAdapter);

    const result = detectRunnerMode();
    expect(result).toBe(RunnerMode.PROD);
  });

  it("should auto-detect DEV mode when NODE_ENV is development", () => {
    const mockAdapter = new PlatformAdapter();

    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "development";
      return undefined;
    });

    setPlatform(mockAdapter);

    const result = detectRunnerMode();
    expect(result).toBe(RunnerMode.DEV);
  });

  it("should auto-detect TEST mode when NODE_ENV is test", () => {
    const mockAdapter = new PlatformAdapter();

    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "test";
      return undefined;
    });

    setPlatform(mockAdapter);

    const result = detectRunnerMode();
    expect(result).toBe(RunnerMode.TEST);
  });

  it("should return DEV as default when NODE_ENV is undefined or unknown", () => {
    const mockAdapter = new PlatformAdapter();

    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "staging"; // unknown value
      return undefined;
    });

    setPlatform(mockAdapter);

    const result = detectRunnerMode();
    expect(result).toBe(RunnerMode.DEV);

    // Test with undefined NODE_ENV
    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return undefined;
      return undefined;
    });

    const result2 = detectRunnerMode();
    expect(result2).toBe(RunnerMode.DEV);
  });
});
