import { defineResource } from "../../../define";
import type { TunnelRunner } from "../../../globals/resources/tunnel/types";
import { run } from "../../../run";
import { globalTags } from "../../../globals/globalTags";
import { defineEvent, defineHook } from "../../../define";
import { createMessageError } from "../../../errors";

describe("tunnel.middleware coverage", () => {
  it("mirror mode propagates remote error after local", async () => {
    const ev = defineEvent<{ x: number }>({ id: "cov.tunnel.ev" });
    const seen: number[] = [];
    const hk = defineHook({
      id: "cov.tunnel.hk",
      on: ev,
      run: async (e: { data: { x: number } }) => {
        seen.push(e.data.x);
      },
    });

    const tunnel = defineResource({
      id: "cov.tunnel.res",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [ev.id],
        eventDeliveryMode: "mirror",
        emit: async () => {
          throw createMessageError("remote boom");
        },
      }),
    });

    const app = defineResource({
      id: "cov.tunnel.app",
      register: [ev, hk, tunnel],
      dependencies: { ev },
      init: async (_, { ev }) => {
        await ev({ x: 1 });
      },
    });
    await expect(run(app)).rejects.toThrow(/remote boom/);
    expect(seen).toEqual([1]);
  });

  it("remote-first: succeeds remotely and skips local", async () => {
    const ev = defineEvent<{ x: number }>({ id: "cov.tunnel.ev.rf" });
    const seen: number[] = [];
    const hk = defineHook({
      id: "cov.tunnel.hk.rf",
      on: ev,
      run: async (e: { data: { x: number } }) => {
        seen.push(e.data.x);
      },
    });

    const tunnel = defineResource({
      id: "cov.tunnel.res.rf",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [ev.id],
        eventDeliveryMode: "remote-first",
        emit: async () => {
          /* ok */
        },
      }),
    });

    const app = defineResource({
      id: "cov.tunnel.app.rf",
      register: [ev, hk, tunnel],
      dependencies: { ev },
      init: async (_, { ev }) => {
        await ev({ x: 2 });
      },
    });
    await expect(run(app)).resolves.toBeDefined();
    expect(seen).toEqual([]);
  });

  it("uses String(item) fallback when event selector has unsupported item type", async () => {
    const tunnel = defineResource({
      id: "cov.tunnel.res.invalid-selector",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [123 as unknown as string],
        emit: async () => undefined,
      }),
    });

    const app = defineResource({
      id: "cov.tunnel.app.invalid-selector",
      register: [tunnel],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      "Event 123 not found while trying to resolve events for tunnel.",
    );
  });

  it("uses object.id branch when event selector item is an object", async () => {
    const tunnel = defineResource({
      id: "cov.tunnel.res.object-selector",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        events: [{ id: "cov.tunnel.missing.event" } as any],
        emit: async () => undefined,
      }),
    });

    const app = defineResource({
      id: "cov.tunnel.app.object-selector",
      register: [tunnel],
      init: async () => undefined,
    });

    await expect(run(app)).rejects.toThrow(
      "Event cov.tunnel.missing.event not found while trying to resolve events for tunnel.",
    );
  });

  it("skips unsupported primitive task selector entries without throwing", async () => {
    const tunnel = defineResource({
      id: "cov.tunnel.res.invalid-task-selector",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "client",
        tasks: [123 as unknown as string],
        run: async () => undefined,
      }),
    });

    const app = defineResource({
      id: "cov.tunnel.app.invalid-task-selector",
      register: [tunnel],
      init: async () => undefined,
    });

    await expect(run(app)).resolves.toBeDefined();
  });
});
