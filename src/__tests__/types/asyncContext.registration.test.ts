import { defineResource } from "../../define";
import { run } from "../../run";
import { r, resources } from "../../index";

describe("asyncContext registration", () => {
  it("appears in store.asyncContexts after registration", async () => {
    const ctx = r.asyncContext<{ id: string }>("spec-ctx-reg").build();
    const app = defineResource({ id: "spec-app-ctx", register: [ctx] });
    const runtime = await run(app);
    const store = await runtime.getResourceValue(resources.store);
    const resolvedId = store.resolveDefinitionId(ctx)!;
    const registered = store.asyncContexts.get(resolvedId);
    expect(registered?.id).toBe(resolvedId);
    await runtime.dispose();
  });

  it("prevents duplicate async context ids on registration", async () => {
    const ctx = r.asyncContext("spec-ctx-dup").build();
    const app = defineResource({
      id: "spec-app-ctx-dup",
      register: [ctx, ctx],
    });
    await expect(run(app)).rejects.toThrow();
  });
});
