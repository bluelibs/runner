import { globals, r, run } from "@bluelibs/runner/node";

import { ResourceId, TaskId, TunnelMode } from "../ids.js";
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
  createNotePhantom,
  listAuditsPhantom,
  listNotesPhantom,
  logAuditPhantom,
} from "./phantoms.js";

enum IdPrefix {
  Note = "note-",
  Audit = "audit-",
}

enum ErrorMessage {
  UnsupportedTask = "Memory tunnel received an unsupported task id",
  InvalidNoteInput = "Invalid NoteInput",
  InvalidAuditInput = "Invalid AuditInput",
}

type MemoryTunnelClientValue = {
  mode: TunnelMode;
  tasks: TaskId[];
  run: (task: { id: string }, input: unknown) => Promise<unknown>;
};

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

  const tunnelClient = r
    .resource(ResourceId.TunnelClient)
    .tags([globals.tags.tunnel])
    .init(async (): Promise<MemoryTunnelClientValue> => ({
      mode: TunnelMode.Client,
      tasks: [
        TaskId.CreateNote,
        TaskId.ListNotes,
        TaskId.LogAudit,
        TaskId.ListAudits,
      ],
      run: async (task, input) => {
        switch (task.id) {
          case TaskId.CreateNote:
            assertNoteInput(input);
            return state.createNote(input);
          case TaskId.ListNotes:
            return state.listNotes();
          case TaskId.LogAudit:
            assertAuditInput(input);
            return state.logAudit(input);
          case TaskId.ListAudits:
            return state.listAudits();
          default:
            throw new Error(`${ErrorMessage.UnsupportedTask}: ${task.id}`);
        }
      },
    }))
    .build();

  const app = r
    .resource(ResourceId.ClientApp)
    .register([
      tunnelClient,
      createNotePhantom,
      listNotesPhantom,
      logAuditPhantom,
      listAuditsPhantom,
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
