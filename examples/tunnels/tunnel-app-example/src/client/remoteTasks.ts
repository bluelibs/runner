import { r } from "@bluelibs/runner/node";

import { TaskId } from "../ids.js";
import type { AuditEntry, AuditInput, Note, NoteInput } from "../types.js";

enum ErrorMessage {
  MustBeRouted = "This task must be routed through the tunnel client resource.",
}

export const createNoteRemoteTask = r
  .task<NoteInput>(TaskId.CreateNote)
  .run(async () => {
    throw new Error(ErrorMessage.MustBeRouted);
  })
  .build();

export const listNotesRemoteTask = r
  .task<void>(TaskId.ListNotes)
  .run(async (): Promise<Note[]> => {
    throw new Error(ErrorMessage.MustBeRouted);
  })
  .build();

export const logAuditRemoteTask = r
  .task<AuditInput>(TaskId.LogAudit)
  .run(async () => {
    throw new Error(ErrorMessage.MustBeRouted);
  })
  .build();

export const listAuditsRemoteTask = r
  .task<void>(TaskId.ListAudits)
  .run(async (): Promise<AuditEntry[]> => {
    throw new Error(ErrorMessage.MustBeRouted);
  })
  .build();
