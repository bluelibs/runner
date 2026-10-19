import { r, run } from "../../../../index";
import { resources } from "../../../node";
import { durableResource } from "../../../durable/core/resource";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import { MemoryEventBus } from "../../../durable/bus/MemoryEventBus";
import { DurableContext } from "../../../durable/core/DurableContext";
import { executeEvent } from "../../../durable/bridge/execute";
import type { DurableEventInput } from "../../../durable/bridge/types";
import { runtimeSource } from "../../../../types/runtimeSource";

const logs = { printThreshold: null } as const;

export async function setup(
  body: () => Promise<unknown> = async () => "receipt",
  undo: () => Promise<void> = async () => {},
) {
  const backend = new MemoryStore();
  const durable = durableResource.fork("workflows");
  const event = r.event("created").build();
  const hook = r.hook("effect").on(event).run(body).compensate(undo).build();
  const runtime = await run(
    r
      .resource("app")
      .register([
        resources.durable,
        durable.with({ store: backend }),
        event,
        hook,
      ])
      .build(),
    { logs },
  );
  const store = runtime.getResourceValue(resources.store);
  const d = runtime.getResourceValue(durable);
  const use = jest.spyOn(d, "use");
  const input: DurableEventInput = {
    eventId: store.findIdByDefinition(event),
    hookIds: [store.findIdByDefinition(hook)],
    resourceId: store.findIdByDefinition(durable),
    data: undefined,
    timestamp: new Date(),
    source: runtimeSource.runtime("test"),
    version: "1",
    compensation: false,
  };
  await backend.saveExecution({
    id: "execution",
    workflowKey: "test",
    status: "running",
    input,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const execute = async (overrides: Partial<DurableEventInput> = {}) => {
    use.mockReturnValue(
      new DurableContext(backend, new MemoryEventBus(), "execution", 1),
    );
    return executeEvent(
      { ...input, ...overrides },
      {
        store,
        manager: runtime.getResourceValue(resources.eventManager),
        serializer: runtime.getResourceValue(resources.serializer),
        backend,
        durable: d,
        inHook: (fn) => fn(),
      },
    );
  };
  return { execute, input, store, backend, close: () => runtime.dispose() };
}
