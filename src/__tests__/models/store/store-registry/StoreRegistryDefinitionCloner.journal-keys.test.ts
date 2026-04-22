import { journal } from "../../../../models/ExecutionJournal";
import { StoreRegistryDefinitionCloner } from "../../../../models/store/store-registry/StoreRegistryDefinitionCloner";
import { defineTaskMiddleware } from "../../../../define";

describe("StoreRegistryDefinitionCloner journal keys", () => {
  it("keeps journal key ids stable when middleware ids are cloned", () => {
    const traceKey = journal.createKey<string>("trace");
    const middleware = defineTaskMiddleware({
      id: "traceWriter",
      journal: {
        trace: traceKey,
      },
      run: async ({ next }) => next(),
    });
    const cloner = new StoreRegistryDefinitionCloner();
    const cloned = cloner.cloneWithId(
      middleware,
      "app.taskMiddlewares.traceWriter",
    );
    const executionJournal = journal.create();

    executionJournal.set(middleware.journalKeys.trace, "value");

    expect(middleware.journalKeys.trace).toBe(traceKey);
    expect(cloned.journalKeys.trace).toBe(traceKey);
    expect(middleware.journalKeys.trace.id).toBe("trace");
    expect(cloned.journalKeys.trace.id).toBe("trace");
    expect(executionJournal.get(cloned.journalKeys.trace)).toBe("value");
  });
});
