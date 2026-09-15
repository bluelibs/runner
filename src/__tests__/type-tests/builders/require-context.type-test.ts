import { middleware, r } from "../../../index";
import type { IAsyncContext } from "../../../index";

export function requireRealContexts() {
  const primitive = r.asyncContext<string>("primitive").build();
  const object = r.asyncContext<{ userId: string }>("object").build();
  const validated = r
    .asyncContext("validated")
    .schema({ userId: String })
    .build();

  middleware.task.requireContext.with({ context: primitive });
  middleware.task.requireContext.with({ context: object });
  middleware.task.requireContext.with({ context: validated });
  middleware.task.requireContext.with({ context: { use: () => "value" } });

  // @ts-expect-error A context with a callable use() method is required.
  middleware.task.requireContext.with({ context: {} });
  // @ts-expect-error The use member must be a function.
  middleware.task.requireContext.with({ context: { use: "value" } });
  // @ts-expect-error Context is required in the middleware configuration.
  middleware.task.requireContext.with({});
}

export function requireGenericContext<T>(context: IAsyncContext<T>) {
  return middleware.task.requireContext.with({ context });
}
