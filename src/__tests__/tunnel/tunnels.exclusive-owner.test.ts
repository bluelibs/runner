import { defineTask, defineResource } from "../../define";
import { run } from "../../run";
import { globalTags } from "../../globals/globalTags";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";

describe("Tunnel exclusivity (single owner per task)", () => {
  it("throws when two tunnels try to own the same task", async () => {
    const t = defineTask<{ x: number }, Promise<number>>({
      id: "spec.tunnels.exclusive.task",
      run: async (i) => i.x + 1,
    });

    const tunnelA = defineResource({
      id: "spec.tunnels.exclusive.tunnelA",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t.id],
        run: async (_task, input: any) => input?.x ?? 0,
      }),
    });

    const tunnelB = defineResource({
      id: "spec.tunnels.exclusive.tunnelB",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [t.id],
        run: async (_task, input: any) => (input?.x ?? 0) * 10,
      }),
    });

    const app = defineResource({
      id: "spec.tunnels.exclusive.app",
      register: [t, tunnelA, tunnelB],
    });

    await expect(run(app)).rejects.toThrow(/already tunneled by resource/);
  });
});
