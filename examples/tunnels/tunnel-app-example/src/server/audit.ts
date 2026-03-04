import { r } from "@bluelibs/runner";

import { ResourceId, TaskId } from "../ids.js";
import { appRpcLane } from "../rpcLane.js";
import type { AuditEntry, AuditInput } from "../types.js";

type AuditStoreValue = {
  log: (action: string) => AuditEntry;
  list: () => AuditEntry[];
};

function createAuditStoreInstance(): AuditStoreValue {
  let nextId = 1;
  const entries: AuditEntry[] = [];
  return {
    log(action: string): AuditEntry {
      const entry: AuditEntry = {
        id: `audit-${nextId++}`,
        action,
        timestamp: new Date(),
      };
      entries.push(entry);
      console.log(`[server/audit] Logged: ${entry.id} - ${action}`);
      return entry;
    },
    list(): AuditEntry[] {
      console.log(`[server/audit] Listed: ${entries.length} entries`);
      return [...entries];
    },
  };
}

export const auditStore = r
  .resource<void>(ResourceId.AuditStore)
  .init(async (): Promise<AuditStoreValue> => createAuditStoreInstance())
  .build();

export const logAudit = r
  .task(TaskId.LogAudit)
  .tags([r.runner.tags.rpcLane.with({ lane: appRpcLane })])
  .dependencies({ store: auditStore })
  .run(
    async (input: AuditInput, deps): Promise<AuditEntry> =>
      deps.store.log(input.action),
  )
  .build();

export const listAudits = r
  .task(TaskId.ListAudits)
  .tags([r.runner.tags.rpcLane.with({ lane: appRpcLane })])
  .dependencies({ store: auditStore })
  .run(async (_input: void, deps): Promise<AuditEntry[]> => deps.store.list())
  .build();
