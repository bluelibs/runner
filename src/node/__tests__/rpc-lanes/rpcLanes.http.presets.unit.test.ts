import { defineResource } from "../../../define";
import { run } from "../../../run";
import { globalResources } from "../../../globals/globalResources";
import { Serializer } from "../../../serializer";
import { r } from "../../node";

describe("rpcLane node http preset registration", () => {
  it("registers mixed preset in node entry and routes via fetch path", async () => {
    const helper = r.rpcLane.httpClient({
      client: "mixed",
      baseUrl: "http://example.test/__runner",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: true, result: "mixed-ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as any,
    });

    const runtime = await run(
      defineResource({ id: "tests-rpc-preset-mixed-app", register: [] }) as any,
    );
    const store = await runtime.getResourceValue(globalResources.store as any);
    const serializer = await runtime.getResourceValue(
      globalResources.serializer as any,
    );
    const communicator = await helper(
      {},
      {
        store,
        serializer,
      },
    );
    await expect(
      communicator.task!("tests.rpc-preset.task", { v: 1 }),
    ).resolves.toBe("mixed-ok");
    await expect(
      communicator.task!("tests.rpc-preset.task", { v: 1 }, { headers: {} }),
    ).resolves.toBe("mixed-ok");
    await expect(
      communicator.event?.("tests.rpc-preset.event", { v: 1 }),
    ).resolves.toBeUndefined();
    await expect(
      communicator.event?.("tests.rpc-preset.event", { v: 1 }, { headers: {} }),
    ).resolves.toBeUndefined();
    await expect(
      communicator.eventWithResult?.("tests.rpc-preset.event", { v: 1 }),
    ).resolves.toBe("mixed-ok");
    await expect(
      communicator.eventWithResult?.(
        "tests.rpc-preset.event",
        { v: 1 },
        { headers: {} },
      ),
    ).resolves.toBe("mixed-ok");
    await runtime.dispose();
  });

  it("registers smart preset in node entry", async () => {
    const helper = r.rpcLane.httpClient({
      client: "smart",
      baseUrl: "http://127.0.0.1:9/__runner",
      timeoutMs: 5,
    });
    const communicator = await helper(
      {},
      {
        serializer: new Serializer(),
      },
    );
    expect(typeof communicator.task).toBe("function");
    await expect(
      communicator.task!("tests.rpc-preset.task", { v: 1 }),
    ).rejects.toBeTruthy();
    await expect(
      communicator.task!("tests.rpc-preset.task", { v: 1 }, { headers: {} }),
    ).rejects.toBeTruthy();
    await expect(
      communicator.event?.("tests.rpc-preset.event", { v: 1 }),
    ).rejects.toBeTruthy();
    await expect(
      communicator.event?.("tests.rpc-preset.event", { v: 1 }, { headers: {} }),
    ).rejects.toBeTruthy();
    await expect(
      communicator.eventWithResult?.("tests.rpc-preset.event", { v: 1 }),
    ).rejects.toBeTruthy();
    await expect(
      communicator.eventWithResult?.(
        "tests.rpc-preset.event",
        { v: 1 },
        { headers: {} },
      ),
    ).rejects.toBeTruthy();
  });

  it("creates serializer internally for mixed preset when serializer dependency is absent", async () => {
    const helper = r.rpcLane.httpClient({
      client: "mixed",
      baseUrl: "http://example.test/__runner",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ ok: true, result: "mixed-default-serializer" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )) as any,
    });

    const runtime = await run(
      defineResource({
        id: "tests-rpc-preset-mixed-no-serializer-app",
        register: [],
      }) as any,
    );
    const store = await runtime.getResourceValue(globalResources.store as any);

    const communicator = await helper({}, { store });
    await expect(
      communicator.task!("tests.rpc-preset.task", { v: 2 }),
    ).resolves.toBe("mixed-default-serializer");

    await runtime.dispose();
  });
});
