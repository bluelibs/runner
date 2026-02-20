import { defineTask, defineResource } from "../../define";
import { run } from "../../run";
import { isTask, isPhantomTask } from "../../define";
import { globalTags } from "../../globals/globalTags";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";
import { phantomTaskNotRoutedError } from "../../errors";

describe("Phantom tasks", () => {
  it("throws when executed directly without a tunnel route", async () => {
    const ph = defineTask.phantom<{ v: string }, Promise<string>>({
      id: "app.tasks.phantom.1",
    });
    const regularTask = defineTask({
      id: "app.tasks.regular.1",
      run: async () => "ok",
    });

    // Basic branding checks
    expect(isTask(ph)).toBe(true);
    expect(isPhantomTask(ph)).toBe(true);
    expect(isPhantomTask(regularTask)).toBe(false);

    const appDirect = defineResource({
      id: "app.phantom.basic",
      register: [ph],
      dependencies: { ph },
      init: async (_, { ph }) => {
        await ph({ v: "x" });
      },
    });

    await expect(run(appDirect)).rejects.toMatchObject({
      name: phantomTaskNotRoutedError.id,
    });

    const appRunTask = defineResource({
      id: "app.phantom.basic.runTask",
      register: [ph],
    });

    const rr = await run(appRunTask);
    await expect(rr.runTask(ph, { v: "y" })).rejects.toMatchObject({
      name: phantomTaskNotRoutedError.id,
    });
    await rr.dispose();
  });

  it("fails fast when used as a dependency without tunnel routing", async () => {
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
        return d.ph({ x: i.n });
      },
    });

    const app = defineResource({
      id: "app.phantom.dep",
      register: [ph, usesPhantom],
      dependencies: { usesPhantom },
      init: async (_, { usesPhantom }) => usesPhantom({ n: 3 }),
    });

    await expect(run(app)).rejects.toMatchObject({
      name: phantomTaskNotRoutedError.id,
    });
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
