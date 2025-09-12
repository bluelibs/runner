import { defineTask, defineResource } from "../define";
import { run } from "../run";
import { globalTags } from "../globals/globalTags";

describe("Tunnel Tag & Middleware", () => {
  it("overrides selected tasks via ids array", async () => {
    const t1 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.t1",
      run: async (input) => `ORIG1:${input?.v}`,
    });
    const t2 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.t2",
      run: async (input) => `ORIG2:${input?.v}`,
    });

    // Resource exposing a tunnel runner
    const tunnelRes = defineResource({
      id: "app.resources.tunnel",
      tags: [globalTags.tunnel.with({ tasks: [t1.id] })],
      init: async () => ({
        run: async (taskId: string, input: any) => `TUN:${taskId}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app",
      register: [t1, t2, tunnelRes],
      dependencies: { t1, t2, tunnelRes },
      init: async (_, { t1, t2 }) => {
        const a = await t1({ v: "A" });
        const b = await t2({ v: "B" });
        return { a, b };
      },
    });

    const rr = await run(app);
    const value = rr.value as any;
    expect(value.a).toBe("TUN:app.tasks.t1:A");
    expect(value.b).toBe("ORIG2:B");
    await rr.dispose();
  });

  it("overrides tasks via filter function", async () => {
    const t1 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.f1",
      run: async (input) => `OF1:${input?.v}`,
    });
    const t2 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.f2",
      run: async (input) => `OF2:${input?.v}`,
    });
    const t3 = defineTask<{ v: string }, Promise<string>>({
      id: "app.other.t3",
      run: async (input) => `O3:${input?.v}`,
    });

    const tunnelRes = defineResource({
      id: "app.resources.tunnel.filter",
      tags: [
        globalTags.tunnel.with({
          tasks: (task) => task.id.startsWith("app.tasks."),
        }),
      ],
      init: async () => ({
        run: async (taskId: string, input: any) => `FT:${taskId}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app.filter",
      register: [t1, t2, t3, tunnelRes],
      dependencies: { t1, t2, t3, tunnelRes },
      init: async (_, { t1, t2, t3 }) => {
        const a = await t1({ v: "A" });
        const b = await t2({ v: "B" });
        const c = await t3({ v: "C" });
        return { a, b, c };
      },
    });

    const rr = await run(app);
    const value = rr.value as any;
    expect(value.a).toBe("FT:app.tasks.f1:A");
    expect(value.b).toBe("FT:app.tasks.f2:B");
    expect(value.c).toBe("O3:C");
    await rr.dispose();
  });

  it("throws when tasks includes a missing string id", async () => {
    const tunnelRes = defineResource({
      id: "app.resources.tunnel.missingId",
      tags: [globalTags.tunnel.with({ tasks: ["app.tasks.unknown"] })],
      init: async () => ({
        run: async (taskId: string, input: any) => `TUN:${taskId}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app.missingId",
      register: [tunnelRes],
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(
      "Task app.tasks.unknown not found while trying to resolve tasks for tunnel.",
    );
  });

  it("throws when tasks includes an unregistered task object", async () => {
    const notRegistered = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.unreg",
      run: async (input) => `ORIG:${input?.v}`,
    });

    const tunnelRes = defineResource({
      id: "app.resources.tunnel.unreg",
      tags: [globalTags.tunnel.with({ tasks: [notRegistered] })],
      init: async () => ({
        run: async (taskId: string, input: any) => `TUN:${taskId}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app.unreg",
      register: [tunnelRes],
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(
      "Task [object Object] not found while trying to resolve tasks for tunnel.",
    );
  });

  it("overrides tasks via task object definitions", async () => {
    const t1 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.obj1",
      run: async (input) => `ORIG1:${input?.v}`,
    });
    const t2 = defineTask<{ v: string }, Promise<string>>({
      id: "app.tasks.obj2",
      run: async (input) => `ORIG2:${input?.v}`,
    });

    const tunnelRes = defineResource({
      id: "app.resources.tunnel.objects",
      tags: [globalTags.tunnel.with({ tasks: [t1] })],
      init: async () => ({
        run: async (taskId: string, input: any) => `OBJ:${taskId}:${input?.v}`,
      }),
    });

    const app = defineResource({
      id: "app.objects",
      register: [t1, t2, tunnelRes],
      dependencies: { t1, t2 },
      init: async (_, { t1, t2 }) => {
        const a = await t1({ v: "A" });
        const b = await t2({ v: "B" });
        return { a, b };
      },
    });

    const rr = await run(app);
    const value = rr.value as any;
    expect(value.a).toBe("OBJ:app.tasks.obj1:A");
    expect(value.b).toBe("ORIG2:B");
    await rr.dispose();
  });
});
