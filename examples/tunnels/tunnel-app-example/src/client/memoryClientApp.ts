import { r, run } from "@bluelibs/runner";
import { rpcLanesResource } from "@bluelibs/runner/node";

import { AuthToken, ResourceId, RpcProfile, RuntimeTaskId } from "../ids.js";
import { appRpcLane } from "../rpcLane.js";
import type {
  AuditEntry,
  AuditInput,
  DemoResult,
  Note,
  NoteInput,
} from "../types.js";
import { assertDefined } from "../assertDefined.js";
import { demoTask } from "./demoTask.js";
import {
  createNoteRemoteTask,
  listAuditsRemoteTask,
  listNotesRemoteTask,
  logAuditRemoteTask,
} from "./remoteTasks.js";

enum IdPrefix {
  Note = "note-",
  Audit = "audit-",
}

enum ErrorMessage {
  UnsupportedTask = "Memory RPC communicator received an unsupported task id",
  InvalidNoteInput = "Invalid NoteInput",
  InvalidAuditInput = "Invalid AuditInput",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function assertNoteInput(value: unknown): asserts value is NoteInput {
  if (!isRecord(value)) {
    throw new TypeError(ErrorMessage.InvalidNoteInput);
  }
  if (typeof value["title"] !== "string" || typeof value["body"] !== "string") {
    throw new TypeError(ErrorMessage.InvalidNoteInput);
  }
}

function assertAuditInput(value: unknown): asserts value is AuditInput {
  if (!isRecord(value)) {
    throw new TypeError(ErrorMessage.InvalidAuditInput);
  }
  if (typeof value["action"] !== "string") {
    throw new TypeError(ErrorMessage.InvalidAuditInput);
  }
}

function createMemoryServerState() {
  let nextNoteId = 1;
  let nextAuditId = 1;
  const notes: Note[] = [];
  const audits: AuditEntry[] = [];

  return {
    createNote(input: NoteInput): Note {
      const note: Note = {
        id: `${IdPrefix.Note}${nextNoteId++}`,
        title: input.title,
        body: input.body,
        createdAt: new Date(),
      };
      notes.push(note);
      return note;
    },
    listNotes(): Note[] {
      return [...notes];
    },
    logAudit(input: AuditInput): AuditEntry {
      const entry: AuditEntry = {
        id: `${IdPrefix.Audit}${nextAuditId++}`,
        action: input.action,
        timestamp: new Date(),
      };
      audits.push(entry);
      return entry;
    },
    listAudits(): AuditEntry[] {
      return [...audits];
    },
  };
}

export function buildMemoryClientApp() {
  const state = createMemoryServerState();

  const communicator = r
    .resource<void>(ResourceId.MemoryCommunicator)
    .init(async () => ({
      task: async (taskId: string, input?: unknown): Promise<unknown> => {
        switch (taskId) {
          case RuntimeTaskId.CreateNote:
            assertNoteInput(input);
            return state.createNote(input);
          case RuntimeTaskId.ListNotes:
            return state.listNotes();
          case RuntimeTaskId.LogAudit:
            assertAuditInput(input);
            return state.logAudit(input);
          case RuntimeTaskId.ListAudits:
            return state.listAudits();
          default:
            throw new Error(`${ErrorMessage.UnsupportedTask}: ${taskId}`);
        }
      },
    }))
    .build();

  const topology = r.rpcLane.topology({
    profiles: {
      [RpcProfile.Client]: { serve: [] },
      [RpcProfile.Server]: { serve: [appRpcLane] },
    },
    bindings: [
      {
        lane: appRpcLane,
        communicator,
        auth: { mode: "jwt_hmac", secret: AuthToken.Dev },
      },
    ],
  });

  const rpcLanes = rpcLanesResource.fork(ResourceId.ClientRpcLanes).with({
    profile: RpcProfile.Client,
    mode: "network",
    topology,
  });

  const app = r
    .resource(ResourceId.ClientApp)
    .register([
      communicator,
      rpcLanes,
      createNoteRemoteTask,
      listNotesRemoteTask,
      logAuditRemoteTask,
      listAuditsRemoteTask,
      demoTask,
    ])
    .build();

  return { app, demoTask };
}

export async function runDemoInMemory(): Promise<DemoResult> {
  const { app, demoTask: t } = buildMemoryClientApp();
  const runtime = await run(app);
  try {
    return assertDefined(await runtime.runTask(t));
  } finally {
    await runtime.dispose();
  }
}
