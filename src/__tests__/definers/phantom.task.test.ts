import { defineTask, defineResource } from "../../define";
import { run } from "../../run";
import { isTask, isPhantomTask } from "../../define";
import { globalTags } from "../../globals/globalTags";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";

describe("Phantom tasks", () => {
  it("creates a phantom task that registers and returns undefined when executed directly", async () => {
    const ph = defineTask.phantom<{ v: string }, Promise<string>>({
      id: "app.tasks.phantom.1",
    });

    // Basic branding checks
    expect(isTask(ph)).toBe(true);
    expect(isPhantomTask(ph)).toBe(true);

    const app = defineResource({
      id: "app.phantom.basic",
      register: [ph],
      dependencies: { ph },
      init: async (_, { ph }) => {
        const r = await ph({ v: "x" });
        return r; // should be undefined by default (no-op run)
      },
    });

    const rr = await run(app);
    expect(rr.value).toBeUndefined();

    // runTask path also returns undefined
    const v: string | undefined = await rr.runTask(ph, { v: "y" });
    expect(v).toBeUndefined();
    await rr.dispose();
  });

  it("can be used as a dependency inside another task", async () => {
    const ph = defineTask.phantom<{ x: number }, Promise<number>>({
      id: "app.tasks.phantom.2",
    });

    const usesPhantom = defineTask<
      { n: number },
      Promise<number>,
      { ph: typeof ph }
    >({
      id: "app.tasks.usesPhantom",
      dependencies: { ph },
      run: async (i, d) => {
        const r = await d.ph({ x: i.n });
        // Phantom returns undefined without a tunnel; coerce to 0
        return (r as unknown as number) ?? 0;
      },
    });

    const app = defineResource({
      id: "app.phantom.dep",
      register: [ph, usesPhantom],
      dependencies: { usesPhantom },
      init: async (_, { usesPhantom }) => usesPhantom({ n: 3 }),
    });

    const rr = await run(app);
    expect(rr.value).toBe(0);
    await rr.dispose();
  });

  it("is routed by tunnel middleware when selected", async () => {
    const ph = defineTask.phantom<{ v: string }, Promise<string>>({
      id: "app.tasks.phantom.tunnel",
    });

    const tunnelRes = defineResource({
      id: "app.resources.phantom.tunnel",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [ph.id],
        run: async (task: any, input: any) => `TUN:${task.id}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app.phantom.tunnel",
      register: [ph, tunnelRes],
      dependencies: { ph, tunnelRes },
      init: async (_, { ph }) => ph({ v: "A" }),
    });

    const rr = await run(app);
    expect(rr.value).toBe("TUN:app.tasks.phantom.tunnel:A");
    await rr.dispose();
  });
});
