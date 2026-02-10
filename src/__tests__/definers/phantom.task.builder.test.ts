import { r, run } from "../..";
import { isTask, isPhantomTask } from "../../define";
import { globalTags } from "../../globals/globalTags";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";
import { phantomTaskNotRoutedError } from "../../errors";

describe("Phantom tasks - fluent builders", () => {
  it("throws when executed directly without a tunnel route", async () => {
    const ph = r.task
      .phantom<{ v: string }, string>("app.tasks.phantom.builder.1")
      .build();

    // Branding checks
    expect(isTask(ph)).toBe(true);
    expect(isPhantomTask(ph)).toBe(true);

    const appDirect = r
      .resource("app.phantom.builder.basic")
      .register([ph])
      .dependencies({ ph })
      .init(async (_c, { ph }) => {
        await ph({ v: "x" });
      })
      .build();

    await expect(run(appDirect)).rejects.toMatchObject({
      name: phantomTaskNotRoutedError.id,
    });

    const appRunTask = r
      .resource("app.phantom.builder.basic.runTask")
      .register([ph])
      .build();
    const rr = await run(appRunTask);
    await expect(rr.runTask(ph, { v: "y" })).rejects.toMatchObject({
      name: phantomTaskNotRoutedError.id,
    });
    await rr.dispose();
  });

  it("fails fast when used as a dependency without tunnel routing (builder)", async () => {
    const ph = r.task
      .phantom<{ x: number }, number>("app.tasks.phantom.builder.2")
      .build();

    const usesPhantom = r
      .task("app.tasks.usesPhantom.builder")
      .dependencies({ ph })
      .run(async (input: { n: number }, deps) => deps.ph({ x: input.n }))
      .build();

    const app = r
      .resource("app.phantom.builder.dep")
      .register([ph, usesPhantom])
      .dependencies({ usesPhantom })
      .init(async (_c, { usesPhantom }) => usesPhantom({ n: 3 }))
      .build();

    await expect(run(app)).rejects.toMatchObject({
      name: phantomTaskNotRoutedError.id,
    });
  });

  it("phantom task is routed by tunnel middleware when selected (builder)", async () => {
    const ph = r.task
      .phantom<{ v: string }, string>("app.tasks.phantom.builder.tunnel")
      .build();

    const tunnelRes = r
      .resource("app.resources.phantom.builder.tunnel")
      .tags([globalTags.tunnel])
      .init(
        async (): Promise<TunnelRunner> => ({
          mode: "client",
          tasks: [ph.id],
          run: async (task: { id: string }, input: { v: string }) =>
            `TUN:${task.id}:${input?.v}`,
        }),
      )
      .build();

    const app = r
      .resource("app.phantom.builder.tunnel")
      .register([ph, tunnelRes])
      .dependencies({ ph })
      .init(async (_c, { ph }) => ph({ v: "A" }))
      .build();

    const rr = await run(app);
    expect(rr.value).toBe("TUN:app.tasks.phantom.builder.tunnel:A");
    await rr.dispose();
  });

  it("phantom builder supports deps append/override, middleware, tags, schemas, meta", () => {
    const t1 = r
      .task("tests.phantom.builder.dummy1")
      .run(async () => 1)
      .build();
    const t2 = r
      .task("tests.phantom.builder.dummy2")
      .run(async () => 2)
      .build();

    const tmw1 = r.middleware
      .task("tests.phantom.builder.tm1")
      .run(async ({ next, task }) => next(task.input))
      .build();
    const tmw2 = r.middleware
      .task("tests.phantom.builder.tm2")
      .run(async ({ next, task }) => next(task.input))
      .build();

    const tagA = r.tag("tests.phantom.builder.tagA").build();
    const tagB = r.tag("tests.phantom.builder.tagB").build();
    const err = r.error("tests.phantom.builder.err").build();

    // Append deps (function + function), then override deps with object
    const ph1 = r.task
      .phantom("tests.phantom.builder.features")
      .dependencies(() => ({ t1 }))
      .dependencies(() => ({ t2 }))
      .middleware([tmw1])
      .middleware([tmw2])
      .tags([tagA])
      .tags([tagB])
      .inputSchema<{ z: number }>({ parse: (x: unknown) => x as { z: number } })
      .resultSchema<number>({ parse: (x: unknown) => x as number })
      .throws([err, err.id])
      .meta({ title: "P" } as Record<string, any>)
      .build();

    const depsMerged =
      typeof ph1.dependencies === "function"
        ? (ph1.dependencies as () => Record<string, any>)()
        : ph1.dependencies;
    expect(Object.keys(depsMerged)).toEqual(["t1", "t2"]);
    expect(ph1.middleware.map((m) => m.id)).toEqual([tmw1.id, tmw2.id]);
    expect(ph1.tags.map((t) => t.id)).toEqual([tagA.id, tagB.id]);
    expect(ph1.inputSchema).toBeTruthy();
    expect(ph1.resultSchema).toBeTruthy();
    expect(ph1.throws).toEqual([err.id]);
    expect(ph1.meta).toBeTruthy();

    const ph2 = r.task
      .phantom("tests.phantom.builder.deps.override")
      .dependencies({ t1 })
      .dependencies({ t2 }, { override: true })
      .build();
    const depsOver =
      typeof ph2.dependencies === "function"
        ? (ph2.dependencies as () => Record<string, any>)()
        : ph2.dependencies;
    expect(Object.keys(depsOver)).toEqual(["t2"]);

    // function + object merge branch for deps
    const ph3 = r.task
      .phantom("tests.phantom.builder.deps.fo")
      .dependencies(() => ({ t1 }))
      .dependencies({ t2 })
      .build();
    const depsFO =
      typeof ph3.dependencies === "function"
        ? (ph3.dependencies as () => Record<string, any>)()
        : ph3.dependencies;
    expect(Object.keys(depsFO)).toEqual(["t1", "t2"]);

    // middleware override branch
    const ph4 = r.task
      .phantom("tests.phantom.builder.mw.override")
      .middleware([tmw1], { override: true })
      .build();
    expect(ph4.middleware.map((m) => m.id)).toEqual([tmw1.id]);
  });
});
