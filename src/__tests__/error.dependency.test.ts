import { defineTask } from "../definers/defineTask";
import { defineResource } from "../define";
import { run } from "../run";
import { error as errorBuilder } from "../definers/builders/error";
import { globals } from "../index";

describe("errors as registrable items and dependencies", () => {
  it("can be registered and injected", async () => {
    const userNotFoundError = errorBuilder("spec.errors.userNotFound").build();

    const checkUser = defineTask<{ id: string }, Promise<void>>({
      id: "spec.tasks.checkUserForErrorDep",
      dependencies: { userNotFoundError },
      run: async ({ id }, { userNotFoundError }) => {
        userNotFoundError.throw({ message: `User ${id} not found` });
      },
    });

    const app = defineResource({
      id: "spec.app.errors",
      register: [userNotFoundError, checkUser],
    });

    const runtime = await run(app);

    await expect(
      runtime.runTask(checkUser, { id: "123" }),
    ).rejects.toThrowError();

    await runtime.runTask(checkUser, { id: "123" }).catch((e) => {
      expect(userNotFoundError.is(e)).toBe(true);
    });

    await runtime.dispose();
  });

  it("supports optional error dependencies, registered and absent", async () => {
    const err = errorBuilder("spec.errors.optional").build();

    const withOpt = defineTask<void, Promise<string>>({
      id: "spec.tasks.opt.present",
      dependencies: { e: err.optional() },
      run: async (_input, { e }) => {
        if (!e) throw new Error("expected helper present");
        return e.id;
      },
    });

    const withoutOpt = defineTask<void, Promise<string | undefined>>({
      id: "spec.tasks.opt.absent",
      dependencies: { e: err.optional() },
      run: async (_input, { e }) => {
        return e?.id;
      },
    });

    const app1 = defineResource({
      id: "spec.app.opt.present",
      register: [err, withOpt],
    });
    const r1 = await run(app1);
    expect(await r1.runTask(withOpt, undefined as any)).toBe(err.id);

    const app2 = defineResource({ id: "spec.app.opt.absent", register: [withoutOpt] });
    const r2 = await run(app2);
    expect(await r2.runTask(withoutOpt, undefined as any)).toBeUndefined();

    await r1.dispose();
    await r2.dispose();
  });

  it("exposes registered errors via store.errors getter", async () => {
    const myErr = errorBuilder("spec.errors.visible").build();
    const app = defineResource({ id: "spec.app.errors.visible", register: [myErr] });
    const runtime = await run(app);
    const store = await runtime.getResourceValue(globals.resources.store);
    expect(store.errors.get(myErr.id)).toBe(myErr);
    await runtime.dispose();
  });
  it("prevents duplicate error ids on registration", async () => {
    const myError = errorBuilder("spec.errors.dup").build();
    const app = defineResource({
      id: "spec.app.errors.dup",
      // same helper twice should conflict by id
      register: [myError, myError],
    });

    await expect(run(app)).rejects.toThrowError();
  });
});
