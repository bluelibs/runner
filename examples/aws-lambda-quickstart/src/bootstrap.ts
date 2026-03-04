import { r, run, RunResult } from "@bluelibs/runner";

/** Request context shape for Lambda handlers */
export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
}

/** Type for the users repository */
export type UsersRepo = {
  get: (id: string) => Promise<{ id: string; name: string } | null>;
  create: (input: { name: string }) => Promise<{ id: string; name: string }>;
};

export const RequestCtx = r.asyncContext<RequestContext>("request").build();

export const users = r
  .resource("users")
  .init(async (): Promise<UsersRepo> => {
    const db = new Map<string, { id: string; name: string }>();
    return {
      get: async (id: string) => db.get(id) ?? null,
      create: async (input: { name: string }) => {
        const id = String(db.size + 1);
        const doc = { id, name: input.name };
        db.set(id, doc);
        return doc;
      },
    };
  })
  .build();

export const getUser = r
  .task<{ id: string }>("getUser")
  .dependencies({ users })
  .run(async (input, { users }) => users.get(input.id))
  .build();

export const createUser = r
  .task<{ name: string }>("createUser")
  .dependencies({ users })
  .run(async (input, { users }) => users.create({ name: input.name }))
  .build();

export const app = r
  .resource("app")
  .register([RequestCtx, users, getUser, createUser])
  .build();

let rrPromise: Promise<RunResult<void>> | null = null;

export async function getRunner() {
  if (!rrPromise) {
    rrPromise = run(app, {
      shutdownHooks: false,
      errorBoundary: true,
      logs: { printThreshold: "info", printStrategy: "json" },
    });
  }

  return rrPromise;
}
