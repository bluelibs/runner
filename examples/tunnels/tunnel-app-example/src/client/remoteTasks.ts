import { r } from "@bluelibs/runner";

import { TaskId } from "../ids.js";
import { appRpcLane } from "../rpcLane.js";
import type { AuditEntry, AuditInput, Note, NoteInput } from "../types.js";

enum ErrorMessage {
  MustBeRouted = "This task must be routed through rpcLanes.",
}

export const createNoteRemoteTask = r
  .task<NoteInput>(TaskId.CreateNote)
  .tags([r.runner.tags.rpcLane.with({ lane: appRpcLane })])
  .run(async () => {
    throw new Error(ErrorMessage.MustBeRouted);
  })
  .build();

export const listNotesRemoteTask = r
  .task<void>(TaskId.ListNotes)
  .tags([r.runner.tags.rpcLane.with({ lane: appRpcLane })])
  .run(async (): Promise<Note[]> => {
    throw new Error(ErrorMessage.MustBeRouted);
  })
  .build();

export const logAuditRemoteTask = r
  .task<AuditInput>(TaskId.LogAudit)
  .tags([r.runner.tags.rpcLane.with({ lane: appRpcLane })])
  .run(async () => {
    throw new Error(ErrorMessage.MustBeRouted);
  })
  .build();

export const listAuditsRemoteTask = r
  .task<void>(TaskId.ListAudits)
  .tags([r.runner.tags.rpcLane.with({ lane: appRpcLane })])
  .run(async (): Promise<AuditEntry[]> => {
    throw new Error(ErrorMessage.MustBeRouted);
  })
  .build();
