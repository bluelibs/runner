import { r } from "@bluelibs/runner/node";

import { TaskId } from "../ids.js";
import type { AuditEntry, AuditInput, Note, NoteInput } from "../types.js";

export const createNotePhantom = r.task
  .phantom<NoteInput, Note>(TaskId.CreateNote)
  .build();

export const listNotesPhantom = r.task
  .phantom<void, Note[]>(TaskId.ListNotes)
  .build();

export const logAuditPhantom = r.task
  .phantom<AuditInput, AuditEntry>(TaskId.LogAudit)
  .build();

export const listAuditsPhantom = r.task
  .phantom<void, AuditEntry[]>(TaskId.ListAudits)
  .build();
