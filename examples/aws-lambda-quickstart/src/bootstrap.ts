import { Match, r, run, type RunResult } from "@bluelibs/runner";

type PublicUser = {
  id: string;
  name: string;
};

type StoredUser = PublicUser & {
  createdByRequestId: string;
  lastReadByRequestId?: string;
};

/** Request context shape for Lambda handlers */
export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
}

/** Type for the users repository */
export type UsersRepo = {
  get: (input: {
    id: string;
    lastReadByRequestId: string;
  }) => Promise<StoredUser | null>;
  create: (input: {
    name: string;
    createdByRequestId: string;
  }) => Promise<StoredUser>;
};

export const RequestCtx = r.asyncContext<RequestContext>("request").build();

const createUserInputSchema = Match.compile({
  name: Match.NonEmptyString,
});

const getUserInputSchema = Match.compile({
  id: Match.NonEmptyString,
});

function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
  };
}

export const users = r
  .resource("users")
  .init(async (): Promise<UsersRepo> => {
    const db = new Map<string, StoredUser>();

    return {
      get: async ({ id, lastReadByRequestId }) => {
        const stored = db.get(id);
        if (!stored) {
          return null;
        }

        const updated = { ...stored, lastReadByRequestId };
        db.set(id, updated);

        return updated;
      },
      create: async ({ name, createdByRequestId }) => {
        const id = String(db.size + 1);
        const doc = { id, name, createdByRequestId };
        db.set(id, doc);
        return doc;
      },
    };
  })
  .build();

export const getUser = r
  .task<{ id: string }>("getUser")
  .inputSchema(getUserInputSchema)
  .dependencies({ users, requestContext: RequestCtx })
  .middleware([RequestCtx.require()])
  .run(async (input, { users, requestContext }) => {
    const { requestId } = requestContext.use();
    const user = await users.get({
      id: input.id,
      lastReadByRequestId: requestId,
    });

    return user ? toPublicUser(user) : null;
  })
  .build();

export const createUser = r
  .task<{ name: string }>("createUser")
  .inputSchema(createUserInputSchema)
  .dependencies({ users, requestContext: RequestCtx })
  .middleware([RequestCtx.require()])
  .run(async (input, { users, requestContext }) => {
    const { requestId } = requestContext.use();
    const created = await users.create({
      name: input.name,
      createdByRequestId: requestId,
    });

    return toPublicUser(created);
  })
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
      logs: { printThreshold: null },
    }).catch((error: unknown) => {
      rrPromise = null;
      throw error;
    });
  }

  return rrPromise;
}

export async function disposeRunner(): Promise<void> {
  const current = rrPromise;
  rrPromise = null;

  if (!current) {
    return;
  }

  const runtime = await current;
  await runtime.dispose();
}
