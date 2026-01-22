import { EventManager } from "../../models/EventManager";
import { defineEvent } from "../../define";

describe("EventManager Consistency", () => {
  describe("Snapshot Isolation", () => {
    it("should prevent listeners from being added during emission", async () => {
      const mgr = new EventManager();
      const event = defineEvent<void>({
        id: "test.event",
        parallel: false,
      });
      let listenerCallCount = 0;

      // Register G1
      // G1 adds G2 with a higher order priority, so it WOULD be executed if the list was live
      let g2Added = false;
      mgr.addGlobalListener(async () => {
        if (!g2Added) {
          mgr.addGlobalListener(
            async () => {
              listenerCallCount++;
            },
            { order: 100 },
          );
          g2Added = true;
        }
      });

      // Trigger emission.
      // Expected: G1 runs. G2 is added, but should NOT run in this emission.
      await mgr.emit(event, undefined, "source");

      expect(listenerCallCount).toBe(0);

      // Verify G2 runs on NEXT emission
      await mgr.emit(event, undefined, "source");
      expect(listenerCallCount).toBe(1);
    });
  });

  describe("Cycle Detection", () => {
    it("should strictly prevent infinite recursion even if hook re-emits same event", async () => {
      const mgr = new EventManager({ runtimeCycleDetection: true });
      const event = defineEvent<void>({ id: "loop.event" });

      let callCount = 0;
      const hook = {
        id: "test.hook",
        run: async () => {
          callCount++;
          if (callCount > 5)
            throw new Error(
              "Infinite Loop Detected manually - CycleContext failed to stop it",
            );
          // Emit same event, claiming to be this hook (source=hook.id)
          // This previously triggered the "safeReEmitBySameHook" bypass in CycleContext
          await mgr.emit(event, undefined, "test.hook");
        },
      };

      // Setup: Listener triggers the hook
      mgr.addListener(event, async (e) => {
        await mgr.executeHookWithInterceptors(hook as any, e, {} as any);
      });

      // Initial emission
      await expect(mgr.emit(event, undefined, "initial")).rejects.toThrow(
        /cycle detected/i,
      );
    });
  });
});
