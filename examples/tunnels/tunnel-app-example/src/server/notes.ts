import { r } from "@bluelibs/runner/node";

import { ResourceId, TaskId } from "../ids.js";
import type { Note, NoteInput } from "../types.js";

type NotesStoreValue = {
  create: (input: NoteInput) => Note;
  list: () => Note[];
};

function createNotesStoreInstance(): NotesStoreValue {
  let nextId = 1;
  const notes: Note[] = [];
  return {
    create(input: NoteInput): Note {
      const note: Note = {
        id: `note-${nextId++}`,
        title: input.title,
        body: input.body,
        createdAt: new Date(),
      };
      notes.push(note);
      console.log(`[server/notes] Created: ${note.id} - ${note.title}`);
      return note;
    },
    list(): Note[] {
      console.log(`[server/notes] Listed: ${notes.length} notes`);
      return [...notes];
    },
  };
}

export const notesStore = r
  .resource<void>(ResourceId.NotesStore)
  .init(async (): Promise<NotesStoreValue> => createNotesStoreInstance())
  .build();

export const createNote = r
  .task(TaskId.CreateNote)
  .dependencies({ store: notesStore })
  .run(async (input: NoteInput, deps): Promise<Note> => deps.store.create(input))
  .build();

export const listNotes = r
  .task(TaskId.ListNotes)
  .dependencies({ store: notesStore })
  .run(async (_input: void, deps): Promise<Note[]> => deps.store.list())
  .build();
