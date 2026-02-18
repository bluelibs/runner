import { registerProcessLevelSafetyNets } from "../../tools/processShutdownHooks";

describe("processShutdownHooks", () => {
  it("logs when a process safety-net handler throws", async () => {
    expect.assertions(2);
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const cleanup = registerProcessLevelSafetyNets(async () => {
      throw "handler failed";
    });
    try {
      process.emit("uncaughtException", "uncaught value" as unknown as Error);
      process.emit("unhandledRejection", "rejection value", Promise.resolve());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleSpy).toHaveBeenCalledWith(
        "[runner] Process error handler failed.",
        expect.objectContaining({ source: "uncaughtException" }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[runner] Process error handler failed.",
        expect.objectContaining({ source: "unhandledRejection" }),
      );
    } finally {
      cleanup();
      consoleSpy.mockRestore();
    }
  });
});
