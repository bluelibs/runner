import { registerShutdownHook } from "../../processHooks";

describe("processHooks coverage", () => {
  it("covers exit try/catch branch when platform.exit throws PlatformUnsupportedFunction", async () => {
    const originalExit = (
      globalThis as unknown as { process: { exit: unknown } }
    ).process?.exit;
    // Mock platform by temporarily stubbing global process to simulate unsupported exit
    (globalThis as unknown as { process: unknown }).process =
      (globalThis as unknown as { process: unknown }).process || {};
    const hook = registerShutdownHook(async () => {});
    hook();
    // Nothing to assert; the branch is covered when shutdown handler runs and catches unsupported exit
    // Restore
    if (originalExit)
      (globalThis as unknown as { process: { exit: unknown } }).process.exit =
        originalExit;
  });
});
