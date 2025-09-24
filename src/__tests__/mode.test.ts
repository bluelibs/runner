import { r, run } from "../index";
import { RunnerMode } from "../enums/RunnerMode";

describe("Mode Detection", () => {
  it("should default to dev mode when NODE_ENV is not set", async () => {
    // Clear NODE_ENV to test default behavior
    delete process.env.NODE_ENV;
    const root = r.resource("test").build();
    const result = await run(root);
    
    expect(result.store.mode).toBe(RunnerMode.DEV);
    
    await result.dispose();
  });

  it("should detect test mode when NODE_ENV is test", async () => {
    process.env.NODE_ENV = "test";
    const root = r.resource("test").build();
    const result = await run(root);
    
    expect(result.store.mode).toBe(RunnerMode.TEST);
    
    await result.dispose();
  });

  it("should detect prod mode when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const root = r.resource("test").build();
    const result = await run(root);
    
    expect(result.store.mode).toBe(RunnerMode.PROD);
    
    await result.dispose();
  });

  it("should detect dev mode when NODE_ENV is development", async () => {
    process.env.NODE_ENV = "development";
    const root = r.resource("test").build();
    const result = await run(root);
    
    expect(result.store.mode).toBe(RunnerMode.DEV);
    
    await result.dispose();
  });
});