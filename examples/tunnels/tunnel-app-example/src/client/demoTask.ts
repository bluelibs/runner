import { r } from "@bluelibs/runner/node";

import { TaskId } from "../ids.js";
import type { DemoResult } from "../types.js";
import {
  createNotePhantom,
  listNotesPhantom,
  listAuditsPhantom,
  logAuditPhantom,
} from "./phantoms.js";

export const demoTask = r
  .task(TaskId.Demo)
  .dependencies({
    createNote: createNotePhantom,
    listNotes: listNotesPhantom,
    logAudit: logAuditPhantom,
    listAudits: listAuditsPhantom,
  })
  .run(async (_input: void, deps): Promise<DemoResult> => {
    console.log("\n[client] Starting demo - calling services via tunnel\n");

    const note1 = await deps.createNote({
      title: "Hello",
      body: "First note from tunnel",
    });
    console.log("[client] Received note:", note1);

    const note2 = await deps.createNote({
      title: "World",
      body: "Second note from tunnel",
    });
    console.log("[client] Received note:", note2);

    await deps.logAudit({ action: "note.created: Hello" });
    await deps.logAudit({ action: "note.created: World" });

    const notes = await deps.listNotes();
    console.log("[client] All notes:", notes?.length);

    const audits = await deps.listAudits();
    console.log("[client] All audits:", audits?.length);

    return {
      notes: notes ?? [],
      audits: audits ?? [],
    };
  })
  .build();
