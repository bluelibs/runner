import type { RegisterableItem } from "../../../defs";
import { r } from "../../../";
import { defineResource } from "../../../define";
import { run } from "../../../run";

type SiblingScope = "billing" | "crm";

type SiblingTaskIds = Record<SiblingScope, string>;

type SiblingTaskFactory = (scope: SiblingScope) => RegisterableItem;

interface CollisionRuntimeContext {
  runtime: Awaited<ReturnType<typeof run>>;
  taskIds: SiblingTaskIds;
}

interface WithSiblingTaskCollisionRuntimeOptions<T> {
  appId: string;
  localTaskId?: string;
  register?: RegisterableItem[];
  createTask: SiblingTaskFactory;
  test: (context: CollisionRuntimeContext) => Promise<T>;
}

export async function withSiblingTaskCollisionRuntime<T>({
  appId,
  localTaskId = "sync",
  register = [],
  createTask,
  test,
}: WithSiblingTaskCollisionRuntimeOptions<T>): Promise<T> {
  const app = defineResource({
    id: appId,
    register: [
      ...register,
      r
        .resource("billing")
        .register([createTask("billing")])
        .build(),
      r
        .resource("crm")
        .register([createTask("crm")])
        .build(),
    ],
  });

  const runtime = await run(app);
  const taskIds: SiblingTaskIds = {
    billing: `${appId}.billing.tasks.${localTaskId}`,
    crm: `${appId}.crm.tasks.${localTaskId}`,
  };

  try {
    return await test({ runtime, taskIds });
  } finally {
    await runtime.dispose();
  }
}
