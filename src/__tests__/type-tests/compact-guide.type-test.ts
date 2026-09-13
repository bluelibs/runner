import { r, resources, run } from "../../index";

export async function documentedContracts(err: unknown) {
  const userNotFound = r.error<{ userId: string }>("userNotFound").build();
  userNotFound.is(err, { userId: "u1" });
  // @ts-expect-error Error matching accepts only the declared data shape.
  userNotFound.is(err, { severity: "high" });

  const invalidateUser = r
    .task("invalidateUser")
    .dependencies({ cache: resources.cache })
    .run(async (_input, { cache }) => {
      await cache.invalidateKeys("storage-key");
      await cache.invalidateRefs("user:123");
    })
    .build();
  // @ts-expect-error Cache operations belong to its resolved value.
  resources.cache.invalidateKeys("storage-key");

  const devToolsResource = r.resource("devTools").build();
  const app = r
    .resource<{ enableDevTools: boolean }>("app")
    .register((config, mode) => [
      resources.cache,
      invalidateUser,
      ...(config.enableDevTools && mode === "dev" ? [devToolsResource] : []),
    ])
    .build();
  const runtime = await run(app.with({ enableDevTools: true }), {
    mode: "dev",
  });
  await runtime.dispose();
}
