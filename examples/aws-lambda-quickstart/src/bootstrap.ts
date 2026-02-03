// In this repository example we import from the local build output.
// In a real project, use: import { resource, task, run, createContext } from "@bluelibs/runner";
import {
  resource,
  task,
  run,
  createContext,
  RunResult,
} from "@bluelibs/runner";

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

export const RequestCtx = createContext<RequestContext>("app.http.request");

export const usersRepo = resource({
  id: "app.resources.usersRepo",
  init: async (): Promise<UsersRepo> => {
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
  run: async (input: { id: string }, { users }) => {
    return users.get(input.id);
  },
});

export const createUser = task({
  id: "app.tasks.createUser",
  dependencies: { users: usersRepo },
  run: async (input: { name: string }, { users }) => {
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
