export type NoteInput = { title: string; body: string };

export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
};

export type AuditInput = { action: string };

export type AuditEntry = {
  id: string;
  action: string;
  timestamp: Date;
};

export type DemoResult = {
  notes: Note[];
  audits: AuditEntry[];
};

