// In this repository example we import from the local build output.
// In a real project, use: import { resource, task, run, createContext } from "@bluelibs/runner";
import {
  resource,
  task,
  run,
  createContext,
  RunResult,
} from "@bluelibs/runner";

// Keep it simple for local example typing; real apps should type this
export const RequestCtx: any = createContext("app.http.request");

export const usersRepo = resource({
  id: "app.resources.usersRepo",
  init: async () => {
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
  },
});

export const getUser = task({
  id: "app.tasks.getUser",
  dependencies: { users: usersRepo },
  run: async (input: { id: string }, { users }: any) => {
    const _req = RequestCtx.use();
    return users.get(input.id);
  },
});

export const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { users: usersRepo },
  run: async (input: { name: string }, { users }: any) => {
    const _req = RequestCtx.use();
    return users.create({ name: input.name });
  },
});

export const app = resource({
  id: "app",
  register: [usersRepo, getUser, createUser],
});

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
